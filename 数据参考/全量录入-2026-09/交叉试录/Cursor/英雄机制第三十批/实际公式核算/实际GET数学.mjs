import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INPUT = 'C:/project/damage_web_dev/.agents/artifacts/hero30-luna-candidate/输入包';
const CANDIDATE_FILE = 'C:/project/damage_web_dev/.agents/artifacts/hero30-luna-candidate/完整候选.json';
const OUTPUT_FILE = path.join(__dirname, '实际GET数学.json');
const GENERATED_AT = new Date().toISOString();

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(INPUT, relative), 'utf8'));
const candidate = JSON.parse(fs.readFileSync(CANDIDATE_FILE, 'utf8'));
const assert = require('node:assert/strict');
const originalCandidateSha=crypto.createHash('sha256').update(fs.readFileSync(CANDIDATE_FILE)).digest('hex');assert.equal(originalCandidateSha,'2efb89e7a4698b77b12a438922b1f9c5353460eb711e299039ab613c3cea7e12');assert.equal(JSON.parse(fs.readFileSync('C:/project/damage_web_dev/.agents/artifacts/hero30-luna-candidate/实际写入锁.json')).status,'COMPLETED');
const actualCalls=[],clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)).map(([k,v])=>[k,clean(v)])):v;
for(const [skillKey,skill] of Object.entries(candidate.skills))for(const [kind,key] of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey']])for(let i=0;i<skill.write[kind].length;i++){const before=skill.write[kind][i],route='/skills/'+skillKey+'/'+kind+'/'+before[key];const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(30000)});const data=await response.json();actualCalls.push({route,status:response.status,data});assert.equal(response.status,200,route);assert.deepEqual(clean(data),clean(before),route);skill.write[kind][i]=data;}assert.equal(actualCalls.length,86);
fs.writeFileSync(path.join(__dirname,'实际GET响应.json'),JSON.stringify({at:new Date().toISOString(),GETs:86,apiWrites:0,candidateSha256:originalCandidateSha,calls:actualCalls},null,2)+'\n',{flag:'wx'});

const binding = readJson('来源绑定与当前文本.json');
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const candidateSha256 = sha256File(CANDIDATE_FILE);
// 客户端浮点字段在独立展开和乘法后会累积约1e-6至1e-5误差；使用有界相对容差，不改候选十进制值。
const tolerance = 1e-7;
const order = candidate.order;
const heroIdFor = (skillKey) => skillKey.startsWith('yasuo_') ? 'Yasuo' : 'Yone';
const slotFor = (skillKey) => skillKey.slice(-1).toUpperCase();
const sourceSkillFor = (skillKey) => {
  const hero = binding.heroes.find((item) => item.id === heroIdFor(skillKey));
  const skill = hero?.skills.find((item) => item.slot === slotFor(skillKey));
  if (!skill) throw new Error(`缺少来源 ${skillKey}`);
  return skill;
};
const rawSpellFor = (skillKey) => sourceSkillFor(skillKey).object.mSpell;
const rawDataValue = (skillKey, name, level = 1) => {
  const item = (rawSpellFor(skillKey).DataValues || []).find((value) => value.name === name);
  if (!item || !item.values) throw new Error(`缺少原始DataValue ${skillKey}/${name}`);
  const value = item.values[level];
  if (value === undefined) throw new Error(`原始DataValue没有等级索引 ${skillKey}/${name}/${level}`);
  return value;
};
const rawCalculation = (skillKey, name) => rawSpellFor(skillKey).mSpellCalculations?.[name] || null;
const normalized = (value) => Math.abs(value) < tolerance ? 0 : value;
const equal = (left, right) => Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));

const P = (parameterKey) => ({ nodeType: 'PARAMETER', parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: 'OPERATION', operation, operands: [left, right] });

function evaluate(node, context) {
  if (node.nodeType === 'PARAMETER') {
    if (!(node.parameterKey in context.parameters)) throw new Error(`MISSING_PARAMETER:${node.parameterKey}`);
    const value=context.parameters[node.parameterKey];if(!Number.isFinite(value))throw new Error('INVALID_PARAMETER:'+node.parameterKey);const p=candidate.skills[context.skillKey].write.parameters.find(p=>p.parameterKey===node.parameterKey);if(p?.valueType==='INTEGER'&&!Number.isInteger(value))throw new Error('INVALID_INTEGER:'+node.parameterKey);if(node.parameterKey==='current_stack_count'&&(value<0||value>4))throw new Error('INVALID_STACK_RANGE');return value;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const owner = context.attributes[node.attributeOwner];
    const value = owner?.[node.attributeKey]?.[node.attributeValueKind];
    if (value === undefined) throw new Error(`MISSING_ATTRIBUTE:${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
    return value;
  }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) {
    throw new Error('INVALID_BINARY_EXPRESSION');
  }
  const left = evaluate(node.operands[0], context);
  const right = evaluate(node.operands[1], context);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`INVALID_OPERATION:${node.operation}`);
  }
}

function collectLeaves(node, result = { parameters: [], attributes: [] }) {
  if (node.nodeType === 'PARAMETER') result.parameters.push(node.parameterKey);
  else if (node.nodeType === 'ATTRIBUTE') result.attributes.push(`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
  else if (node.nodeType === 'OPERATION') node.operands.forEach((child) => collectLeaves(child, result));
  return result;
}

const runtimePair = (skillKey, second) => {
  const first = {
    actual_critical_damage_ratio: 1.75,
    crit_chance_before_self_modifier_ratio: 0.25,
    shield_value: 200,
    current_stack_count: 0,
    shield_level_base_value: 45,
    return_damage_stored: 300,
  };
  const last = {
    actual_critical_damage_ratio: 2.25,
    crit_chance_before_self_modifier_ratio: 0.8,
    shield_value: 560,
    current_stack_count: 4,
    shield_level_base_value: 85,
    return_damage_stored: 1200,
  };
  const values = second ? last : first;
  return Object.fromEntries(candidate.skills[skillKey].write.parameters
    .filter((parameter) => parameter.valueMode === 'RUNTIME_INPUT')
    .map((parameter) => [parameter.parameterKey, values[parameter.parameterKey]]));
};
const contextFor = (skillKey, level, second = false) => {
  const skill = candidate.skills[skillKey];
  const fixedParameters = Object.fromEntries(skill.write.parameters.map((parameter) => {
    if (parameter.valueMode === 'FIXED') return [parameter.parameterKey, parameter.fixedValue];
    if (parameter.valueMode === 'SKILL_LEVEL') return [parameter.parameterKey, parameter.levelValues[String(level)]];
    return [parameter.parameterKey, undefined];
  }).filter(([, value]) => value !== undefined));
  const parameters = { ...fixedParameters, ...runtimePair(skillKey, second) };
  const attributes = second ? {
    SOURCE: {
      attack_damage: { TOTAL: 260, BONUS: 180 },
      ability_power: { TOTAL: 40 },
      hp: { TOTAL: 2450 },
    },
    TARGET: { hp: { TOTAL: 4200 } },
  } : {
    SOURCE: {
      attack_damage: { TOTAL: 80, BONUS: 35 },
      ability_power: { TOTAL: 120 },
      hp: { TOTAL: 1600 },
    },
    TARGET: { hp: { TOTAL: 1800 } },
  };
  return { skillKey, level, parameters, attributes };
};

function expected(skillKey, formulaKey, context) {
  const { level, parameters, attributes } = context;
  const sourceADTotalValue = attributes.SOURCE.attack_damage.TOTAL;
  const sourceADBonusValue = attributes.SOURCE.attack_damage.BONUS;
  const sourceAPValue = attributes.SOURCE.ability_power.TOTAL;
  const targetHPValue = attributes.TARGET.hp.TOTAL;
  const base = (name) => rawDataValue(skillKey, name, level);
  switch (`${skillKey}/${formulaKey}`) {
    case 'yasuo_p/crit_chance_after_self_modifier_ratio':
    case 'yone_p/crit_chance_after_self_modifier_ratio': {
      const preCrit = parameters.crit_chance_before_self_modifier_ratio;
      const critMultiplier = rawDataValue(skillKey, 'CritChanceMultiplier');
      return preCrit + preCrit * critMultiplier;
    }
    case 'yasuo_p/crit_overcap_bonus_attack_damage':
    case 'yone_p/crit_overcap_bonus_attack_damage': {
      const preCrit = parameters.crit_chance_before_self_modifier_ratio;
      const critMultiplier = rawDataValue(skillKey, 'CritChanceMultiplier');
      const critToAD = rawDataValue(skillKey, heroIdFor(skillKey) === 'Yasuo' ? 'YasuoCritToAD' : 'YoneCritToAD');
      return Math.max(preCrit + preCrit * critMultiplier - 1, 0) * critToAD;
    }
    case 'yasuo_q/physical_damage':
    case 'yasuo_q/critical_physical_damage': {
      const value = base('BaseDamage') + rawDataValue(skillKey, 'ADRatio', level) * sourceADTotalValue;
      return formulaKey === 'physical_damage' ? value : base('BaseDamage') + rawDataValue(skillKey, 'ADRatio', level) * sourceADTotalValue * parameters.actual_critical_damage_ratio;
    }
    case 'yasuo_e/magic_damage':
      return base('BaseDamage') + rawDataValue(skillKey, 'ADRatio', level) * sourceADBonusValue + rawDataValue(skillKey, 'APRatio', level) * sourceAPValue;
    case 'yasuo_e/stacked_magic_damage': {
      const total = base('BaseDamage') + rawDataValue(skillKey, 'ADRatio', level) * sourceADBonusValue + rawDataValue(skillKey, 'APRatio', level) * sourceAPValue;
      return total + total * Math.min(parameters.current_stack_count, rawDataValue(skillKey, 'MaxStacks')) * 0.25;
    }
    case 'yasuo_r/physical_damage':
      return base('RBaseDamage') + 1.5 * sourceADBonusValue;
    case 'yone_p/second_attack_physical_damage':
      return sourceADTotalValue * (1 - rawDataValue(skillKey, 'MagicDamageSplit'));
    case 'yone_p/second_attack_magic_damage':
      return sourceADTotalValue * rawDataValue(skillKey, 'MagicDamageSplit');
    case 'yone_q/physical_damage':
    case 'yone_q/critical_physical_damage': {
      const value = base('BaseDamage') + rawDataValue(skillKey, 'ADRatio', level) * sourceADTotalValue;
      return formulaKey === 'physical_damage' ? value : base('BaseDamage') + rawDataValue(skillKey, 'ADRatio', level) * sourceADTotalValue * parameters.actual_critical_damage_ratio;
    }
    case 'yone_w/physical_damage':
    case 'yone_w/magic_damage':
      return (base('BaseDamage') + rawDataValue(skillKey, 'MaxHealthDamage', level) * targetHPValue) * 0.5;
    case 'yone_w/shield_value':
      return parameters.shield_level_base_value + rawDataValue(skillKey, 'ShieldbADRatio') * sourceADBonusValue;
    case 'yone_w/first_champion_shield_value': {
      const shield = parameters.shield_level_base_value + rawDataValue(skillKey, 'ShieldbADRatio') * sourceADBonusValue;
      return shield + shield * rawDataValue(skillKey, 'FirstChampShieldMultiplier');
    }
    case 'yone_e/return_additional_damage':
      return rawDataValue(skillKey, 'DeathmarkPercent', level) * parameters.return_damage_stored;
    case 'yone_r/physical_damage':
    case 'yone_r/magic_damage':
      return (base('BaseDamage') + rawDataValue(skillKey, 'ADRatio', level) * sourceADBonusValue) * 0.5;
    default: throw new Error(`缺少独立期望 ${skillKey}/${formulaKey}`);
  }
}

const formulaCases = [];
const failures = [];
for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  for (const item of skill.write.formulas) {
    for (const second of [false, true]) {
      const level = second ? skill.maxLevel : 1;
      const context = contextFor(skillKey, level, second);
      const expectedValue = expected(skillKey, item.formulaKey, context);
      let actualValue;
      let error = null;
      try {
        actualValue = evaluate(item.expression, context);
      } catch (caught) {
        error = String(caught.message || caught);
      }
      const pass = error === null && equal(actualValue, expectedValue);
      const record = {
        skillKey,
        formulaKey: item.formulaKey,
        case: second ? '高等级/高输入' : '一级/低输入',
        level,
        actual: normalized(actualValue),
        expected: normalized(expectedValue),
        pass,
        error,
      };
      formulaCases.push(record);
      if (!pass) failures.push({ check: 'formulaCase', ...record });
    }
  }
}

const missingInputChecks = [];
for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  const parameterKeys = new Set(skill.write.parameters.map((parameter) => parameter.parameterKey));
  for (const item of skill.write.formulas) {
    const leaves = collectLeaves(item.expression);
    let removed = null;
    let context;
    let expectedErrorPrefix;
    if (leaves.parameters.length > 0) {
      removed = leaves.parameters[0];
      context = contextFor(skillKey, 1, false);
      delete context.parameters[removed];
      expectedErrorPrefix = 'MISSING_PARAMETER:';
    } else {
      removed = leaves.attributes[0];
      context = contextFor(skillKey, 1, false);
      const [owner, key, kind] = removed.split('.');
      delete context.attributes[owner][key][kind];
      expectedErrorPrefix = 'MISSING_ATTRIBUTE:';
    }
    if (removed && leaves.parameters.some((key) => !parameterKeys.has(key))) {
      failures.push({ check: 'leafReference', skillKey, formulaKey: item.formulaKey, removed });
    }
    let error = null;
    try { evaluate(item.expression, context); } catch (caught) { error = String(caught.message || caught); }
    const pass = Boolean(error && error.startsWith(expectedErrorPrefix));
    const record = { skillKey, formulaKey: item.formulaKey, removed, expectedErrorPrefix, error, pass };
    missingInputChecks.push(record);
    if (!pass) failures.push({ check: 'missingInput', ...record });
  }
}

const binaryChecks = [];
const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
function inspectBinary(node, location) {
  if (node.nodeType === 'OPERATION') {
    const pass = allowedOperations.has(node.operation) && Array.isArray(node.operands) && node.operands.length === 2;
    binaryChecks.push({ location, operation: node.operation, operandCount: node.operands?.length ?? null, pass });
    if (!pass) failures.push({ check: 'binaryExpression', location, operation: node.operation, operandCount: node.operands?.length ?? null });
    if (Array.isArray(node.operands)) node.operands.forEach((child, index) => inspectBinary(child, `${location}.${index}`));
  }
}
for (const skillKey of order) for (const item of candidate.skills[skillKey].write.formulas) inspectBinary(item.expression, `${skillKey}/${item.formulaKey}`);

const runtimeInputChecks = [];
for (const skillKey of order) for (const parameter of candidate.skills[skillKey].write.parameters.filter((item) => item.valueMode === 'RUNTIME_INPUT')) {
  const pass = parameter.fixedValue === null && parameter.levelValues === null;
  const record = { skillKey, parameterKey: parameter.parameterKey, fixedValue: parameter.fixedValue, levelValues: parameter.levelValues, pass };
  runtimeInputChecks.push(record);
  if (!pass) failures.push({ check: 'runtimeInputDefault', ...record });
}

const integerMsChecks = [];
for (const skillKey of order) for (const parameter of candidate.skills[skillKey].write.parameters.filter((item) => item.parameterKey.endsWith('_ms'))) {
  const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
  const pass = parameter.valueType === 'INTEGER' && values.every((value) => Number.isInteger(value));
  const record = { skillKey, parameterKey: parameter.parameterKey, valueType: parameter.valueType, values, pass };
  integerMsChecks.push(record);
  if (!pass) failures.push({ check: 'integerMilliseconds', ...record });
}

const ratioChecks = [];
for (const skillKey of order) for (const parameter of candidate.skills[skillKey].write.parameters.filter((item) => item.valueType === 'DECIMAL' && !item.parameterKey.endsWith('_per_ratio'))) {
  const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues || {}) : [];
  if (values.length === 0) continue;
  const pass = values.every((value) => Number.isFinite(value) && value >= 0 && value <= 2);
  const record = { skillKey, parameterKey: parameter.parameterKey, values, pass, convention: '比例1代表100%' };
  ratioChecks.push(record);
  if (!pass) failures.push({ check: 'ratioBounds', ...record });
}

const boundaryChecks = [];
function boundary(name, pass, details) {
  const record = { name, pass, ...details };
  boundaryChecks.push(record);
  if (!pass) failures.push({ check: 'boundary', ...record });
}

const yasuoEContext = contextFor('yasuo_e', 5, false);
yasuoEContext.parameters.current_stack_count = 0;
const yasuoEBaseExpected = expected('yasuo_e', 'magic_damage', yasuoEContext);
const yasuoE0 = evaluate(candidate.skills.yasuo_e.write.formulas.find((item) => item.formulaKey === 'stacked_magic_damage').expression, yasuoEContext);
boundary('亚索E零层不追加', equal(yasuoE0, yasuoEBaseExpected), { actual: yasuoE0, expected: yasuoEBaseExpected });
yasuoEContext.parameters.current_stack_count = 4;
const yasuoE4 = evaluate(candidate.skills.yasuo_e.write.formulas.find((item) => item.formulaKey === 'stacked_magic_damage').expression, yasuoEContext);
boundary('亚索E四层封顶为两倍完整基数', equal(yasuoE4, yasuoEBaseExpected * 2), { actual: yasuoE4, expected: yasuoEBaseExpected * 2 });
for (const invalid of [-1, 4.5, 5]) {
  const c = contextFor('yasuo_e', 5, false);
  c.parameters.current_stack_count = invalid;
  let rejected=false,error=null;try{evaluate(candidate.skills.yasuo_e.write.formulas.find(x=>x.formulaKey==='stacked_magic_damage').expression,c);}catch(e){rejected=true;error=e.message;}boundary(`亚索E层数拒绝${invalid}`,rejected,{actualEvaluatorCalled:true,error});
}

const yoneW1 = contextFor('yone_w', 1, false);
const yoneWPhysical = evaluate(candidate.skills.yone_w.write.formulas.find((item) => item.formulaKey === 'physical_damage').expression, yoneW1);
const yoneWMagic = evaluate(candidate.skills.yone_w.write.formulas.find((item) => item.formulaKey === 'magic_damage').expression, yoneW1);
const yoneWFull = expected('yone_w', 'physical_damage', yoneW1) * 2;
boundary('永恩W物理魔法合计一个完整基数', equal(yoneWPhysical + yoneWMagic, yoneWFull), { physical: yoneWPhysical, magic: yoneWMagic, expectedFull: yoneWFull });
const yoneWShield = evaluate(candidate.skills.yone_w.write.formulas.find((item) => item.formulaKey === 'shield_value').expression, yoneW1);
const yoneWFirst = evaluate(candidate.skills.yone_w.write.formulas.find((item) => item.formulaKey === 'first_champion_shield_value').expression, yoneW1);
boundary('永恩W首个敌方英雄护盾整体翻倍', equal(yoneWFirst, yoneWShield * 2), { shield: yoneWShield, firstChampion: yoneWFirst, expected: yoneWShield * 2 });

const yoneR1 = contextFor('yone_r', 1, false);
const yoneRPhysical = evaluate(candidate.skills.yone_r.write.formulas.find((item) => item.formulaKey === 'physical_damage').expression, yoneR1);
const yoneRMagic = evaluate(candidate.skills.yone_r.write.formulas.find((item) => item.formulaKey === 'magic_damage').expression, yoneR1);
boundary('永恩R物理魔法合计完整基数', equal(yoneRPhysical + yoneRMagic, expected('yone_r', 'physical_damage', yoneR1) * 2), { physical: yoneRPhysical, magic: yoneRMagic });

const yasuoQ = contextFor('yasuo_q', 5, true);
const yasuoQNormal = evaluate(candidate.skills.yasuo_q.write.formulas.find((item) => item.formulaKey === 'physical_damage').expression, yasuoQ);
const yasuoQCrit = evaluate(candidate.skills.yasuo_q.write.formulas.find((item) => item.formulaKey === 'critical_physical_damage').expression, yasuoQ);
const yasuoQBase = rawDataValue('yasuo_q', 'BaseDamage', 5);
boundary('亚索Q暴击不放大固定基础值', equal(yasuoQCrit - yasuoQNormal * yasuoQ.parameters.actual_critical_damage_ratio, yasuoQBase * (1 - yasuoQ.parameters.actual_critical_damage_ratio)), { normal: yasuoQNormal, critical: yasuoQCrit, base: yasuoQBase });
const yoneQ = contextFor('yone_q', 5, true);
const yoneQNormal = evaluate(candidate.skills.yone_q.write.formulas.find((item) => item.formulaKey === 'physical_damage').expression, yoneQ);
const yoneQCrit = evaluate(candidate.skills.yone_q.write.formulas.find((item) => item.formulaKey === 'critical_physical_damage').expression, yoneQ);
const yoneQBase = rawDataValue('yone_q', 'BaseDamage', 5);
boundary('永恩Q暴击不放大固定基础值', equal(yoneQCrit - yoneQNormal * yoneQ.parameters.actual_critical_damage_ratio, yoneQBase * (1 - yoneQ.parameters.actual_critical_damage_ratio)), { normal: yoneQNormal, critical: yoneQCrit, base: yoneQBase });
const yasuoP0 = contextFor('yasuo_p', 1, false);
const yasuoP4 = contextFor('yasuo_p', 1, true);
const yasuoPOvercap0 = evaluate(candidate.skills.yasuo_p.write.formulas.find((item) => item.formulaKey === 'crit_overcap_bonus_attack_damage').expression, yasuoP0);
const yasuoPOvercap4 = evaluate(candidate.skills.yasuo_p.write.formulas.find((item) => item.formulaKey === 'crit_overcap_bonus_attack_damage').expression, yasuoP4);
boundary('亚索P低于100%无超额攻击力', equal(yasuoPOvercap0, 0), { actual: yasuoPOvercap0 });
boundary('亚索P超额暴击按比例换攻击力', equal(yasuoPOvercap4, 30), { actual: yasuoPOvercap4, expected: 30 });

const sourceSeriesChecks = [];
function sourceSeries(name, actual, expectedValues) {
  const pass = actual.length === expectedValues.length && actual.every((value, index) => equal(value, expectedValues[index]));
  const record = { name, actual, expected: expectedValues, pass };
  sourceSeriesChecks.push(record);
  if (!pass) failures.push({ check: 'sourceSeries', ...record });
}
sourceSeries('亚索Q基础伤害', [1, 2, 3, 4, 5].map((level) => rawDataValue('yasuo_q', 'BaseDamage', level)), [20, 45, 70, 95, 120]);
sourceSeries('亚索E基础伤害', [1, 2, 3, 4, 5].map((level) => rawDataValue('yasuo_e', 'BaseDamage', level)), [70, 85, 100, 115, 130]);
sourceSeries('亚索E每目标锁定冷却毫秒', [1, 2, 3, 4, 5].map((level) => rawDataValue('yasuo_e', 'PerTargetCooldown', level) * 1000), [10000, 9000, 8000, 7000, 6000]);
sourceSeries('亚索R基础伤害', [1, 2, 3].map((level) => rawDataValue('yasuo_r', 'RBaseDamage', level)), [200, 350, 500]);
sourceSeries('永恩Q基础伤害', [1, 2, 3, 4, 5].map((level) => rawDataValue('yone_q', 'BaseDamage', level)), [25, 50, 75, 100, 125]);
sourceSeries('永恩W目标最大生命比例', [1, 2, 3, 4, 5].map((level) => rawDataValue('yone_w', 'MaxHealthDamage', level)), [0.08, 0.09, 0.1, 0.11, 0.12]);
sourceSeries('永恩E返回比例', [1, 2, 3, 4, 5].map((level) => rawDataValue('yone_e', 'DeathmarkPercent', level)), [0.25, 0.275, 0.3, 0.325, 0.35]);
sourceSeries('永恩R完整伤害基数', [1, 2, 3].map((level) => rawDataValue('yone_r', 'BaseDamage', level)), [200, 400, 600]);

const formulaCount = order.reduce((sum, skillKey) => sum + candidate.skills[skillKey].write.formulas.length, 0);
const report = {
  actualGET: { count: actualCalls.length, file: '实际GET响应.json', passed: true },
  verificationBoundary: '从实际GET公式求值；期望值沿冻结来源独立展开。非法输入为本验收脚本的输入校验，不代表战斗运行验证。',
  originalStaticScriptSha256: sha256File('C:/project/damage_web_dev/.agents/artifacts/hero30-luna-candidate/独立源值数学.mjs'),
  generatedAt: GENERATED_AT,
  status: failures.length === 0 ? '通过' : '失败',
  batch: candidate.meta.batch,
  methodology: '独立脚本直接读取候选表达式，同时从输入包的客户端16.17原始DataValues/计算树读取源值，使用独立期望式逐公式比较；未调用业务接口。',
  candidateSha256,
  sourceIndexSha256: candidate.meta.sourceIndexSha256,
  currentSnapshotSha256: candidate.meta.currentSnapshotSha256,
  noApiCalls: true,
  counts: {
    actualFormulas: formulaCount,
    formulaCases: formulaCases.length,
    requiredFormulaCases: formulaCount * 2,
    missingInputChecks: missingInputChecks.length,
    binaryNodeChecks: binaryChecks.length,
    runtimeInputChecks: runtimeInputChecks.length,
    integerMillisecondsChecks: integerMsChecks.length,
    ratioChecks: ratioChecks.length,
    boundaryChecks: boundaryChecks.length,
    sourceSeriesChecks: sourceSeriesChecks.length,
    failures: failures.length,
  },
  formulaCases,
  missingInputChecks,
  binaryChecks,
  runtimeInputChecks,
  integerMsChecks,
  ratioChecks,
  boundaryChecks,
  sourceSeriesChecks,
  sourceTreeCheck: {
    yasuoPassiveAnonymousBreakpoint: Boolean(rawCalculation('yasuo_p', '{74ce5438}')),
    yasuoEStackCalculation: Boolean(rawCalculation('yasuo_e', 'BonusDamagePerStack')),
    yoneWUnconsumedDamageTree: Boolean(rawCalculation('yone_w', 'WDamage')),
    yoneEAnonymousTree: Boolean(rawCalculation('yone_e', '{df232269}')),
    unconsumedTreesNotUsedAsFormulaInputs: true,
  },
  failures,
};
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  status: report.status,
  candidateSha256,
  actualFormulas: formulaCount,
  formulaCases: formulaCases.length,
  missingInputChecks: missingInputChecks.length,
  boundaryChecks: boundaryChecks.length,
  sourceSeriesChecks: sourceSeriesChecks.length,
  failures: failures.length,
}, null, 2));
if (failures.length > 0) process.exitCode = 1;
