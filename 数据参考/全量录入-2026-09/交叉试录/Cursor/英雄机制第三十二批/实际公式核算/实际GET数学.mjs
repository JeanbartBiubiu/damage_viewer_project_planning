import {expected as sourceExpected} from '../hero32-independent-source-math/source-expected.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const __filename = fileURLToPath(import.meta.url);
const ROOT = 'C:/project/damage_web_dev/.agents/artifacts/hero32-luna-candidate';const outputRoot=path.dirname(__filename),runDir=path.join(outputRoot,new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(runDir,{recursive:true});
const INPUT = path.join(ROOT, '输入包');
const candidate = JSON.parse(fs.readFileSync(path.join(ROOT, '完整候选.json'), 'utf8'));
const assert=require('node:assert/strict');const originalCandidateSha=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'完整候选.json'))).digest('hex');assert.equal(originalCandidateSha,'57f2ca0fcc9b7f29fb8c9df4c93f3d4fe1b474254839a285f08f7f6a1a4e886d');assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'实际写入锁.json'))).status,'COMPLETED');
const actualCalls=[],clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)).map(([k,v])=>[k,clean(v)])):v;
for(const[skillKey,skill]of Object.entries(candidate.skills))for(const[kind,key]of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey']])for(let i=0;i<skill.write[kind].length;i++){const before=skill.write[kind][i],route='/skills/'+skillKey+'/'+kind+'/'+before[key],response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(30000)}),data=await response.json();actualCalls.push({route,status:response.status,data});assert.equal(response.status,200,route);assert.deepEqual(clean(data),clean(before),route);skill.write[kind][i]=data;}assert.equal(actualCalls.length,206);fs.writeFileSync(path.join(runDir,'实际GET响应.json'),JSON.stringify({at:new Date().toISOString(),GETs:206,apiWrites:0,candidateSha256:originalCandidateSha,calls:actualCalls},null,2)+'\n',{flag:'wx'});

const binding = JSON.parse(fs.readFileSync(path.join(INPUT, '来源绑定与当前文本.json'), 'utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const candidateSha256 = sha256(fs.readFileSync(path.join(ROOT, '完整候选.json')));
const order = candidate.order;
const equal = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * (1 + Math.max(Math.abs(a), Math.abs(b)));
const result = { formulaCases: [], missingInputChecks: [], binaryChecks: [], runtimeInputChecks: [], integerMillisecondsChecks: [], ratioChecks: [], boundaryChecks: [], sourceSeriesChecks: [], crossSkillChecks: [], failures: [] };
const fail = (check, details) => result.failures.push({ check, ...details });

const skillParts = (skillKey) => {
  const [hero, slot] = skillKey.split('_');
  return { heroId: hero === 'kaisa' ? 'Kaisa' : `${hero[0].toUpperCase()}${hero.slice(1)}`, slot: slot.toUpperCase() };
};
const rawFor = (skillKey) => {
  const { heroId, slot } = skillParts(skillKey);
  return binding.heroes.find((hero) => hero.id === heroId).skills.find((skill) => skill.slot === slot).object.mSpell;
};
const sourceDV = (skillKey, name, level) => (rawFor(skillKey).DataValues || []).find((item) => item.name === name)?.values?.[level];
const sourceEffect = (skillKey, index, level) => rawFor(skillKey).mEffectAmount?.[index]?.value?.[level];
const sourceCalc = (skillKey, key) => rawFor(skillKey).mSpellCalculations?.[key];

function collectLeaves(node, leaves = { parameters: new Set(), attributes: new Set() }) {
  if (!node || typeof node !== 'object') return leaves;
  if (node.nodeType === 'PARAMETER') leaves.parameters.add(node.parameterKey);
  else if (node.nodeType === 'ATTRIBUTE') leaves.attributes.add(`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
  else if (node.nodeType === 'OPERATION') for (const operand of node.operands || []) collectLeaves(operand, leaves);
  return leaves;
}
function evaluate(node, context) {
  if (!node || typeof node !== 'object') throw new Error('BAD_NODE');
  if (node.nodeType === 'PARAMETER') {
    if (!(node.parameterKey in context.parameters) || context.parameters[node.parameterKey] === undefined || context.parameters[node.parameterKey] === null) throw new Error(`MISSING_PARAMETER:${node.parameterKey}`);
    const value=context.parameters[node.parameterKey];if(!Number.isFinite(value))throw Error('INVALID_PARAMETER:'+node.parameterKey);const p=candidate.skills[context.skillKey].write.parameters.find(p=>p.parameterKey===node.parameterKey);if(p?.valueType==='INTEGER'&&!Number.isInteger(value))throw Error('INVALID_INTEGER:'+node.parameterKey);if(node.parameterKey==='current_stack_count'&&(value<0||value>4))throw Error('INVALID_STACK_RANGE');if(node.parameterKey==='feather_sequence_index'&&value<1)throw Error('INVALID_FEATHER_INDEX');if(node.parameterKey==='current_hypercharge_stack_count'&&value<0)throw Error('INVALID_STACK_RANGE');return value;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const owner = context.attributes[node.attributeOwner] || {};
    const attrs = owner[node.attributeKey] || {};
    if (!(node.attributeValueKind in attrs) || attrs[node.attributeValueKind] === undefined || attrs[node.attributeValueKind] === null) throw new Error(`MISSING_ATTRIBUTE:${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
    return attrs[node.attributeValueKind];
  }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error('BAD_OPERATION');
  const [left, right] = node.operands.map((operand) => evaluate(operand, context));
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`BAD_OPERATION:${node.operation}`);
  }
}
const attributesFor = (high = false) => ({
  SOURCE: {
    attack_damage: { TOTAL: high ? 520 : 200, BONUS: high ? 320 : 100 },
    ability_power: { TOTAL: high ? 800 : 300 },
    move_speed: { TOTAL: high ? 500 : 350 },
  },
  TARGET: { hp: { TOTAL: high ? 5000 : 2000, MISSING: high ? 1800 : 500 } },
});
function runtimeValue(parameterKey, high) {
  const lowHigh = {
    actual_critical_damage_ratio: [1.75, 2.25],
    attack_refund_mstat8_value: [0.1, 0.4],
    base_damage_by_character_level: [4, 30],
    per_stack_damage_by_character_level: [1, 8],
    current_stack_count: [0, 4],
    actual_bonus_attack_speed_ratio: [0, 1.5],
    actual_attack_speed_stat: [0, 1.5],
    actual_critical_chance_ratio: [0.25, 0.8],
    actual_critical_damage_ratio_zeri: [1.75, 2.25],
    q_min_damage_level_base: [10, 25],
    q_passive_execute_threshold_level_base: [70, 160],
    q_passive_max_damage_level_base: [75, 160],
    q_passive_max_charge_hp_ratio: [0.01, 0.11],
    feather_sequence_index: [1, 20],
    current_hypercharge_stack_count: [0, 3],
  };
  if (parameterKey === 'actual_critical_damage_ratio' && high) return 2.25;
  if (parameterKey === 'actual_critical_damage_ratio_zeri') return high ? 2.25 : 1.75;
  const values = lowHigh[parameterKey];
  return values ? values[high ? 1 : 0] : (high ? 1 : 0.2);
}
function contextFor(skillKey, level, high, overrides = {}) {
  const skill = candidate.skills[skillKey];
  const parameters = {};
  for (const item of skill.write.parameters) {
    if (item.valueMode === 'FIXED') parameters[item.parameterKey] = item.fixedValue;
    else if (item.valueMode === 'SKILL_LEVEL') parameters[item.parameterKey] = item.levelValues[String(level)];
    else parameters[item.parameterKey] = runtimeValue(item.parameterKey, high);
  }
  Object.assign(parameters, overrides);
  return { skillKey, level, parameters, attributes: attributesFor(high) };
}
const p = (context, key) => context.parameters[key];
const at = (context, owner, key, kind) => context.attributes[owner][key][kind];
function expected(skillKey, formulaKey, context) {
  const q = (key) => p(context, key);
  const adT = at(context, 'SOURCE', 'attack_damage', 'TOTAL');
  const adB = at(context, 'SOURCE', 'attack_damage', 'BONUS');
  const ap = at(context, 'SOURCE', 'ability_power', 'TOTAL');
  const ms = at(context, 'SOURCE', 'move_speed', 'TOTAL');
  const hpT = at(context, 'TARGET', 'hp', 'TOTAL');
  const hpM = at(context, 'TARGET', 'hp', 'MISSING');
  switch (`${skillKey}/${formulaKey}`) {
    case 'corki_p/basic_attack_extra_true_damage': return q('attack_conversion_ratio') * adT;
    case 'corki_p/critical_extra_true_damage': return q('attack_conversion_ratio') * adT * q('actual_critical_damage_ratio');
    case 'corki_q/magic_damage': return q('base_damage') + q('bonus_attack_damage_ratio') * adB + q('ability_power_ratio') * ap;
    case 'corki_w/maximum_magic_damage': return q('maximum_damage_base') + q('ability_power_ratio') * ap + q('bonus_attack_damage_ratio') * adB;
    case 'corki_w/dash_speed': return q('dash_speed_base') + q('dash_speed_move_speed_ratio') * ms;
    case 'corki_e/physical_damage': return q('base_damage') + q('bonus_attack_damage_ratio') * adB;
    case 'corki_r/small_missile_damage': return q('base_damage') + q('bonus_attack_damage_ratio') * adB;
    case 'corki_r/big_missile_damage': return (q('base_damage') + q('bonus_attack_damage_ratio') * adB) * q('big_missile_multiplier');
    case 'corki_r/attack_refund_seconds': return q('attack_refund_base_seconds') * (q('attack_refund_unit') + q('attack_refund_mstat8_coefficient') * q('attack_refund_mstat8_value'));
    case 'kaisa_p/base_plasma_damage': return (q('base_damage_by_character_level') + q('base_ability_power_ratio') * ap) * q('mode_damage_multiplier');
    case 'kaisa_p/per_stack_plasma_damage': return (q('per_stack_damage_by_character_level') + q('per_stack_ability_power_ratio') * ap) * q('mode_damage_multiplier');
    case 'kaisa_p/plasma_attack_damage': return (q('base_damage_by_character_level') + q('base_ability_power_ratio') * ap) * q('mode_damage_multiplier') + (q('per_stack_damage_by_character_level') + q('per_stack_ability_power_ratio') * ap) * q('mode_damage_multiplier') * q('current_stack_count');
    case 'kaisa_p/execute_percentage': return q('execute_missing_health_ratio') + q('execute_ability_power_ratio') * ap;
    case 'kaisa_p/execute_missing_health_damage': return (q('execute_missing_health_ratio') + q('execute_ability_power_ratio') * ap) * hpM;
    case 'kaisa_q/individual_missile_damage': return q('base_damage') + q('bonus_attack_damage_ratio') * adB + q('ability_power_ratio') * ap;
    case 'kaisa_q/subsequent_missile_damage': return (q('base_damage') + q('bonus_attack_damage_ratio') * adB + q('ability_power_ratio') * ap) * q('subsequent_missile_ratio');
    case 'kaisa_q/normal_max_damage': return (q('base_damage') + q('bonus_attack_damage_ratio') * adB + q('ability_power_ratio') * ap) * q('normal_max_damage_multiplier');
    case 'kaisa_q/evolved_max_damage': return (q('base_damage') + q('bonus_attack_damage_ratio') * adB + q('ability_power_ratio') * ap) * q('evolved_max_damage_multiplier');
    case 'kaisa_w/magic_damage': return q('base_damage') + q('total_attack_damage_ratio') * adT + q('ability_power_ratio') * ap;
    case 'kaisa_e/total_move_speed_ratio': return q('move_speed_base_ratio') * Math.min(q('move_speed_clamp_upper'), Math.max(q('move_speed_clamp_lower'), q('move_speed_clamp_lower') + q('actual_bonus_attack_speed_ratio')));
    case 'kaisa_e/total_cast_time_ms': return Math.max(q('cast_time_min_ms'), q('cast_time_base_ms') - q('cast_time_attack_speed_coefficient_ms') * q('actual_attack_speed_stat'));
    case 'kaisa_r/shield_value': return q('shield_base_value') + q('total_attack_damage_ratio') * adT + q('ability_power_ratio') * ap;
    case 'xayah_q/single_dagger_damage': return q('base_damage') + q('bonus_attack_damage_ratio') * adB;
    case 'xayah_q/two_dagger_damage': return (q('base_damage') + q('bonus_attack_damage_ratio') * adB) * q('dagger_count');
    case 'xayah_e/base_feather_damage': return q('base_damage') + q('bonus_attack_damage_ratio') * adB;
    case 'xayah_e/critical_multiplier': return q('one_ratio') + q('critical_effectiveness_ratio') * q('actual_critical_chance_ratio') * (q('actual_critical_damage_ratio') - q('one_ratio'));
    case 'xayah_e/feather_damage_before_falloff': return (q('base_damage') + q('bonus_attack_damage_ratio') * adB) * (q('one_ratio') + q('critical_effectiveness_ratio') * q('actual_critical_chance_ratio') * (q('actual_critical_damage_ratio') - q('one_ratio')));
    case 'xayah_e/feather_falloff_multiplier': return Math.max(q('feather_minimum_multiplier'), q('one_ratio') - q('feather_falloff_ratio') * (q('feather_sequence_index') - q('one_ratio')));
    case 'xayah_e/feather_damage': return (q('base_damage') + q('bonus_attack_damage_ratio') * adB) * (q('one_ratio') + q('critical_effectiveness_ratio') * q('actual_critical_chance_ratio') * (q('actual_critical_damage_ratio') - q('one_ratio'))) * Math.max(q('feather_minimum_multiplier'), q('one_ratio') - q('feather_falloff_ratio') * (q('feather_sequence_index') - q('one_ratio')));
    case 'xayah_r/physical_damage': return q('base_damage') + q('bonus_attack_damage_ratio') * adB;
    case 'zeri_p/unenergized_magic_damage': return q('q_min_damage_level_base') + q('q_min_damage_ability_power_ratio') * ap;
    case 'zeri_p/execute_threshold': return q('q_passive_execute_threshold_level_base') + q('q_passive_execute_threshold_ability_power_ratio') * ap;
    case 'zeri_p/passive_max_damage': return q('q_passive_max_damage_level_base') + q('q_passive_max_damage_ability_power_ratio') * ap;
    case 'zeri_p/full_charge_magic_damage': return q('q_passive_max_damage_level_base') + q('q_passive_max_damage_ability_power_ratio') * ap + q('q_passive_max_charge_hp_ratio') * hpT;
    case 'zeri_q/active_physical_damage': return q('base_damage') + q('total_attack_damage_ratio') * adT;
    case 'zeri_w/normal_physical_damage': return q('base_damage') + q('total_attack_damage_ratio') * adT + q('ability_power_ratio') * ap;
    case 'zeri_w/wall_physical_damage': return (q('base_damage') + q('total_attack_damage_ratio') * adT + q('ability_power_ratio') * ap) * (q('one_ratio') + q('critical_effectiveness_ratio') * (q('actual_critical_damage_ratio') - q('one_ratio')));
    case 'zeri_e/bonus_magic_damage': return (q('bonus_damage_base') + q('bonus_ability_power_ratio') * ap) * (q('one_ratio') + q('critical_scaling_ratio') * q('actual_critical_chance_ratio') * (q('actual_critical_damage_ratio') - q('one_ratio')));
    case 'zeri_e/dash_speed': return q('dash_speed_base') + q('dash_speed_move_speed_ratio') * ms;
    case 'zeri_r/active_magic_damage': return q('active_damage_base') + q('ability_power_ratio') * ap + q('bonus_attack_damage_ratio') * adB;
    case 'zeri_r/hypercharge_move_speed_ratio': return q('move_speed_per_stack_ratio') * q('current_hypercharge_stack_count');
    default: throw new Error(`缺少独立期望 ${skillKey}/${formulaKey}`);
  }
}

for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  for (const item of skill.write.formulas) {
    for (const high of [false, true]) {
      const level = high ? skill.maxLevel : 1;
      const context = contextFor(skillKey, level, high);
      const expectedValue = sourceExpected(skillKey, item.formulaKey, context, binding);
      let actualValue = null;
      let error = null;
      try { actualValue = evaluate(item.expression, context); } catch (caught) { error = String(caught.message || caught); }
      const pass = error === null && equal(actualValue, expectedValue);
      const record = { skillKey, formulaKey: item.formulaKey, case: high ? '高等级高输入' : '一级低输入', actual: actualValue, expected: expectedValue, pass, error };
      result.formulaCases.push(record);
      if (!pass) fail('formulaCase', record);
    }
  }
}

for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  for (const item of skill.write.formulas) {
    const leaves = collectLeaves(item.expression);
    const removed = [...leaves.parameters][0];
    if (!removed) { fail('missingInputSetup', { skillKey, formulaKey: item.formulaKey }); continue; }
    const context = contextFor(skillKey, 1, false);
    delete context.parameters[removed];
    let error = null;
    try { evaluate(item.expression, context); } catch (caught) { error = String(caught.message || caught); }
    const pass = Boolean(error?.startsWith('MISSING_PARAMETER:'));
    const record = { skillKey, formulaKey: item.formulaKey, removed, error, pass };
    result.missingInputChecks.push(record);
    if (!pass) fail('missingInput', record);
  }
}

const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
function inspectBinary(node, location) {
  if (node?.nodeType !== 'OPERATION') return;
  const pass = allowedOperations.has(node.operation) && Array.isArray(node.operands) && node.operands.length === 2;
  const record = { location, operation: node.operation, operandCount: node.operands?.length ?? null, pass };
  result.binaryChecks.push(record);
  if (!pass) fail('binaryExpression', record);
  for (const [index, operand] of (node.operands || []).entries()) inspectBinary(operand, `${location}.${index}`);
}
for (const skillKey of order) for (const item of candidate.skills[skillKey].write.formulas) inspectBinary(item.expression, `${skillKey}/${item.formulaKey}`);

for (const skillKey of order) for (const parameter of candidate.skills[skillKey].write.parameters.filter((item) => item.valueMode === 'RUNTIME_INPUT')) {
  const pass = parameter.fixedValue === null && parameter.levelValues === null;
  const record = { skillKey, parameterKey: parameter.parameterKey, fixedValue: parameter.fixedValue, levelValues: parameter.levelValues, pass };
  result.runtimeInputChecks.push(record);
  if (!pass) fail('runtimeInputDefault', record);
}
for (const skillKey of order) for (const parameter of candidate.skills[skillKey].write.parameters.filter((item) => item.parameterKey.endsWith('_ms'))) {
  const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
  const pass = parameter.valueType === 'INTEGER' && values.every((value) => Number.isInteger(value));
  const record = { skillKey, parameterKey: parameter.parameterKey, valueType: parameter.valueType, values, pass };
  result.integerMillisecondsChecks.push(record);
  if (!pass) fail('integerMilliseconds', record);
}
for (const skillKey of order) for (const parameter of candidate.skills[skillKey].write.parameters.filter((item) => item.valueType === 'DECIMAL' && (item.parameterKey.includes('ratio') || item.parameterKey.includes('percent') || item.parameterKey.includes('effectiveness')))) {
  const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues || {}) : [];
  const pass = values.every((value) => Number.isFinite(value) && value >= 0);
  const record = { skillKey, parameterKey: parameter.parameterKey, values, pass, convention: '比例1代表100%' };
  result.ratioChecks.push(record);
  if (!pass) fail('ratioValue', record);
}

function boundary(name, pass, details) {
  const record = { name, pass, ...details };
  result.boundaryChecks.push(record);
  if (!pass) fail('boundary', record);
}
const q = (skillKey, formulaKey, level, high, overrides = {}) => evaluate(candidate.skills[skillKey].write.formulas.find((item) => item.formulaKey === formulaKey).expression, contextFor(skillKey, level, high, overrides));
const kaisaP0 = q('kaisa_p', 'plasma_attack_damage', 1, false, { current_stack_count: 0 });
const kaisaP4 = q('kaisa_p', 'plasma_attack_damage', 1, false, { current_stack_count: 4 });
const kaisaBase = q('kaisa_p', 'base_plasma_damage', 1, false);
boundary('卡莎P零层等于基础电浆', equal(kaisaP0, kaisaBase), { actual: kaisaP0, expected: kaisaBase });
boundary('卡莎P四层按实际输入增加四层', kaisaP4 > kaisaP0, { zero: kaisaP0, four: kaisaP4 });
for(const invalid of [-1,4.5,5]){let rejected=false,error=null;try{q('kaisa_p','plasma_attack_damage',1,false,{current_stack_count:invalid});}catch(e){rejected=true;error=e.message;}boundary(`卡莎P拒绝非法层数${invalid}`,rejected,{invalid,actualEvaluatorCalled:true,error});}
const kaisaQNormal = q('kaisa_q', 'normal_max_damage', 5, true);
const kaisaQInd = q('kaisa_q', 'individual_missile_damage', 5, true);
const kaisaQEvolved = q('kaisa_q', 'evolved_max_damage', 5, true);
boundary('卡莎Q普通最大量为2.25倍单发', equal(kaisaQNormal, kaisaQInd * 2.25), { actual: kaisaQNormal, expected: kaisaQInd * 2.25 });
boundary('卡莎Q进化最大量为3.75倍单发', equal(kaisaQEvolved, kaisaQInd * 3.75), { actual: kaisaQEvolved, expected: kaisaQInd * 3.75 });
const moveLow = q('kaisa_e', 'total_move_speed_ratio', 1, false, { actual_bonus_attack_speed_ratio: 0 });
const moveHigh = q('kaisa_e', 'total_move_speed_ratio', 5, true, { actual_bonus_attack_speed_ratio: 3 });
boundary('卡莎E移动速度倍率下限', equal(moveLow, 0.55), { actual: moveLow, expected: 0.55 });
boundary('卡莎E移动速度倍率上限', equal(moveHigh, 0.75 * 2), { actual: moveHigh, expected: 1.5 });
const xayahEBase = q('xayah_e', 'feather_damage_before_falloff', 5, true, { actual_critical_chance_ratio: 0.4, actual_critical_damage_ratio: 2, feather_sequence_index: 1 });
for (const index of [1, 3, 19, 20]) {
  const context = contextFor('xayah_e', 5, true, { feather_sequence_index: index, actual_critical_chance_ratio: 0, actual_critical_damage_ratio: 1.75 });
  const actual = evaluate(candidate.skills.xayah_e.write.formulas.find((item) => item.formulaKey === 'feather_falloff_multiplier').expression, context);
  const expectedValue = Math.max(0.1, 1 - 0.05 * (index - 1));
  boundary(`霞E第${index}根逐根倍率`, equal(actual, expectedValue), { actual, expected: expectedValue });
}
const emptyAggregate=[].reduce((sum,index)=>sum+q('xayah_e','feather_damage',5,true,{feather_sequence_index:index}),0);boundary('霞E根数0时总量外部聚合为0',emptyAggregate===0,{count:0,total:emptyAggregate,note:'实际空命中序列，不调用逐根公式'});
boundary('霞E至少3根才满足禁锢阈值', candidate.skills.xayah_e.write.parameters.find((item) => item.parameterKey === 'feather_root_threshold').fixedValue === 3, { threshold: 3 });
const zeriQ = q('zeri_q', 'active_physical_damage', 5, true);
boundary('泽丽Q七颗不重复乘整式', equal(zeriQ,sourceExpected('zeri_q','active_physical_damage',contextFor('zeri_q',5,true),binding)), { actual: zeriQ, missileCount: 7 });
boundary('泽丽Q来源弹体数量为7', candidate.skills.zeri_q.write.parameters.find((item) => item.parameterKey === 'missile_count').fixedValue === 7, { value: 7 });
const cap = candidate.skills.zeri_r.write.parameters.find((item) => item.parameterKey === 'remaining_duration_cap_ms').fixedValue;
for (const [before, extension] of [[0, 2500], [3000, 2500], [5000, 2500]]) boundary(`泽丽R延长上限${before}+${extension}`, Math.min(cap, before + extension) <= 5000, { before, extension, actual: Math.min(cap, before + extension), cap });
boundary('库奇W不乘5次过程', equal(q('corki_w','maximum_magic_damage',5,true),sourceExpected('corki_w','maximum_magic_damage',contextFor('corki_w',5,true),binding)), { maximumTicks: candidate.skills.corki_w.write.parameters.find((item) => item.parameterKey === 'maximum_ticks').fixedValue });
boundary('库奇R当前最大弹药为4', candidate.skills.corki_r.write.parameters.find((item) => item.parameterKey === 'max_ammo').fixedValue === 4, { actual: candidate.skills.corki_r.write.parameters.find((item) => item.parameterKey === 'max_ammo').fixedValue });
boundary('泽丽R超负荷层0不加移动速度', q('zeri_r', 'hypercharge_move_speed_ratio', 3, true, { current_hypercharge_stack_count: 0 }) === 0, { actual: q('zeri_r', 'hypercharge_move_speed_ratio', 3, true, { current_hypercharge_stack_count: 0 }) });
boundary('泽丽R超负荷层3按每层1.5%', equal(q('zeri_r', 'hypercharge_move_speed_ratio', 3, true, { current_hypercharge_stack_count: 3 }), 0.045), { actual: q('zeri_r', 'hypercharge_move_speed_ratio', 3, true, { current_hypercharge_stack_count: 3 }) });


for(const [skillKey,formulaKey,key,values]of [['xayah_e','feather_damage','feather_sequence_index',[-1,0,1.5]],['zeri_r','hypercharge_move_speed_ratio','current_hypercharge_stack_count',[-1,.5]]])for(const invalid of values){let rejected=false,error=null;try{q(skillKey,formulaKey,skillKey==='zeri_r'?3:5,true,{[key]:invalid});}catch(e){rejected=true;error=e.message;}boundary(skillKey+'/'+key+'非法值'+invalid,rejected,{invalid,actualEvaluatorCalled:true,error});}
for(const[count,multiplier]of [[0,0],[1,1],[3,2.85],[19,10.45],[20,10.55]]){let actual=0;for(let index=1;index<=count;index++)actual+=q('xayah_e','feather_damage',5,true,{feather_sequence_index:index});const expectedValue=sourceExpected('xayah_e','feather_damage_before_falloff',contextFor('xayah_e',5,true),binding)*multiplier;boundary('霞E实际'+count+'根聚合',equal(actual,expectedValue),{count,actual,expected:expectedValue});}

function series(name, actual, expectedValues) {
  const pass = actual.length === expectedValues.length && actual.every((value, index) => equal(value, expectedValues[index]));
  const record = { name, actual, expected: expectedValues, pass };
  result.sourceSeriesChecks.push(record);
  if (!pass) fail('sourceSeries', record);
}
series('库奇Q基础伤害', [1, 2, 3, 4, 5].map((level) => sourceDV('corki_q', 'BaseDamage', level)), [60, 105, 150, 195, 240]);
series('库奇W完整基础伤害', [1, 2, 3, 4, 5].map((level) => sourceDV('corki_w', 'BaseDamage', level)), [150, 225, 300, 375, 450]);
series('库奇E削减显示正值', [1, 2, 3, 4, 5].map((level) => Math.abs(sourceDV('corki_e', 'ShredMax', level))), [12, 14, 16, 18, 20]);
series('库奇R小导弹基础', [1, 2, 3].map((level) => sourceDV('corki_r', 'BaseDamage', level)), [90, 170, 250]);
series('卡莎Q单发基础', [1, 2, 3, 4, 5].map((level) => sourceEffect('kaisa_q', 0, level)), [40, 55, 70, 85, 100]);
series('卡莎Q普通进化弹数', [sourceEffect('kaisa_q', 1, 1), sourceEffect('kaisa_q', 6, 1)], [6, 12]);
series('卡莎W基础', [1, 2, 3, 4, 5].map((level) => sourceEffect('kaisa_w', 0, level)), [30, 55, 80, 105, 130]);
series('卡莎E基础移动速度', [1, 2, 3, 4, 5].map((level) => sourceEffect('kaisa_e', 0, level)), [0.55, 0.6, 0.65, 0.7, 0.75]);
series('霞Q基础伤害', [1, 2, 3, 4, 5].map((level) => sourceDV('xayah_q', 'BaseDamage', level)), [45, 60, 75, 90, 105]);
series('霞E基础伤害', [1, 2, 3, 4, 5].map((level) => sourceDV('xayah_e', 'BaseDamage', level)), [50, 65, 80, 95, 110]);
series('霞R基础伤害', [1, 2, 3].map((level) => sourceDV('xayah_r', 'RBaseDamage', level)), [200, 300, 400]);
series('泽丽Q基础与总AD比例', [1, 2, 3, 4, 5].map((level) => sourceDV('zeri_q', 'BaseDamage', level)), [22, 26, 30, 34, 38]);
series('泽丽W基础', [1, 2, 3, 4, 5].map((level) => sourceDV('zeri_w', 'Damage', level)), [30, 70, 110, 150, 190]);
series('泽丽E穿刺比例', [1, 2, 3, 4, 5].map((level) => sourceDV('zeri_e', 'PenDamagePercent', level)), [0.8, 0.85, 0.9, 0.95, 1]);
series('泽丽R主动基础', [1, 2, 3].map((level) => sourceDV('zeri_r', 'ActiveDamage', level)), [150, 250, 350]);
const corkiR = rawFor('corki_r');
const xayahR = rawFor('xayah_r');
result.crossSkillChecks.push({ name: '库奇R当前弹药与充能', maxAmmo: corkiR.mMaxAmmo?.[1], rechargeSeconds: corkiR.mAmmoRechargeTime?.[1], pass: corkiR.mMaxAmmo?.[1] === 4 && corkiR.mAmmoRechargeTime?.[1] === 20 });
result.crossSkillChecks.push({ name: '霞R正文与RUntargetable冲突被保留', textHas150: binding.heroes.find((hero) => hero.id === 'Xayah').skills.find((skill) => skill.slot === 'R').currentTexts.keyTooltip.text.includes('1.5'), rawSeconds: xayahR.DataValues.find((item) => item.name === 'RUntargetable').values[1], pass: binding.heroes.find((hero) => hero.id === 'Xayah').skills.find((skill) => skill.slot === 'R').currentTexts.keyTooltip.text.includes('1.5') && xayahR.DataValues.find((item) => item.name === 'RUntargetable').values[1] === 1.25 });
for (const record of result.crossSkillChecks) if (!record.pass) fail('crossSkill', record);
result.forbiddenComponentChecks = [];
for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  const forbidden = [...skill.write.processes, ...skill.write.internalStates, ...skill.write.triggerRules].length === 0 && skill.write.effects.every((effect) => effect.results.every((row) => row.resultType === 'NORMAL_SHIELD'));
  const record = { skillKey, pass: forbidden, effects: skill.write.effects.map((effect) => effect.results.map((row) => row.resultType)) };
  result.forbiddenComponentChecks.push(record);
  if (!forbidden) fail('forbiddenComponent', record);
}
const formulaCount = order.reduce((sum, skillKey) => sum + candidate.skills[skillKey].write.formulas.length, 0);
result.status = result.failures.length === 0 ? '通过' : '失败';
result.generatedAt = new Date().toISOString();
result.batch = candidate.meta.batch;
result.methodology='206项实际GET详情替换候选表达式与参数后求值；独立来源模块仅从原始树和文本读取固定/等级值，实际输入单独外供。';
result.candidateSha256 = candidateSha256;
result.sourceIndexSha256 = candidate.meta.sourceIndexSha256;
result.currentSnapshotSha256 = candidate.meta.currentSnapshotSha256;
result.noApiCalls = false;result.apiWrites=0;result.actualGET={count:actualCalls.length,file:'实际GET响应.json'};result.sourceExpectedModuleSha256=sha256(fs.readFileSync(new URL('../hero32-independent-source-math/source-expected.mjs',import.meta.url)));result.validationBoundary='实际GET表达式求值，期望由独立代理原始来源模块计算。非法输入为本验收脚本校验，不是战斗运行验证。';
result.counts = {
  actualFormulas: formulaCount,
  formulaCases: result.formulaCases.length,
  requiredFormulaCases: formulaCount * 2,
  missingInputChecks: result.missingInputChecks.length,
  binaryNodeChecks: result.binaryChecks.length,
  runtimeInputChecks: result.runtimeInputChecks.length,
  integerMillisecondsChecks: result.integerMillisecondsChecks.length,
  ratioChecks: result.ratioChecks.length,
  boundaryChecks: result.boundaryChecks.length,
  sourceSeriesChecks: result.sourceSeriesChecks.length,
  crossSkillChecks: result.crossSkillChecks.length,
  forbiddenComponentChecks: result.forbiddenComponentChecks.length,
  failures: result.failures.length,
};
fs.writeFileSync(path.join(runDir, '实际GET数学.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({status:result.status,candidateSha256,counts:result.counts,GETs:actualCalls.length,runDir},null,2));
if (result.failures.length > 0) process.exitCode = 1;
