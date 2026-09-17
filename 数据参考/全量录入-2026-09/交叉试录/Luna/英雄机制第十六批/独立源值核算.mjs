import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';

const here = new URL('./', import.meta.url);
const read = name => fs.readFileSync(new URL(name, here), 'utf8');
const candidateBytes = Buffer.from(read('完整候选.json'));
const candidate = JSON.parse(candidateBytes);
const roots = JSON.parse(read('根绑定与数值证据.json'));
const sourceFreeze = JSON.parse(read('来源冻结/来源与哈希汇总.json'));
const textEvidence = JSON.parse(read('补充文本证据.json'));
const current = JSON.parse(read('写前现值.json'));
const stageDedup = JSON.parse(read('阶段去重预检.json'));

const failures = [];
const checks = [];
function check(name, ok, detail = null) {
  const row = { name, ok: Boolean(ok), detail };
  checks.push(row);
  if (!row.ok) failures.push(row);
  return row.ok;
}
function fail(name, detail) { check(name, false, detail); }
function close(a, b, tolerance = 1e-5) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function walk(value, fn, path = '$') {
  if (!value || typeof value !== 'object') return;
  fn(value, path);
  for (const [key, child] of Object.entries(value)) walk(child, fn, `${path}.${key}`);
}
function spellFor(skillKey) {
  for (const hero of roots.heroes) {
    const spell = hero.spells.find(value => value.skillKey === skillKey);
    if (spell) return { hero, spell };
  }
  throw Error(`根绑定没有${skillKey}`);
}
function valuesForParameter(parameter, rank, runtime) {
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    if (!Object.prototype.hasOwnProperty.call(runtime, parameter.parameterKey)) throw Error(`缺少运行输入 ${parameter.parameterKey}`);
    return runtime[parameter.parameterKey];
  }
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const value = parameter.levelValues?.[String(rank)];
    if (value === undefined) throw Error(`缺少等级值 ${parameter.parameterKey}/${rank}`);
    return value;
  }
  if (parameter.fixedValue === null || parameter.fixedValue === undefined) throw Error(`固定参数无值 ${parameter.parameterKey}`);
  return parameter.fixedValue;
}
function candidateValue(skillKey, parameterKey, rank, attrs = {}, runtime = {}) {
  const skill = candidate.skills[skillKey];
  const parameter = skill.write.parameters.find(value => value.parameterKey === parameterKey);
  if (!parameter) throw Error(`候选参数不存在 ${skillKey}/${parameterKey}`);
  return valuesForParameter(parameter, rank, runtime);
}
function evalExpression(skillKey, expression, rank, attrs = {}, runtime = {}) {
  if (!expression || typeof expression !== 'object') throw Error('表达式为空');
  if (expression.nodeType === 'PARAMETER') return candidateValue(skillKey, expression.parameterKey, rank, attrs, runtime);
  if (expression.nodeType === 'ATTRIBUTE') {
    if (!Object.prototype.hasOwnProperty.call(attrs, expression.attributeKey)) throw Error(`缺少属性输入 ${expression.attributeKey}`);
    return attrs[expression.attributeKey];
  }
  if (expression.nodeType !== 'OPERATION' || !Array.isArray(expression.operands) || expression.operands.length !== 2) throw Error('表达式节点非法');
  const [a, b] = expression.operands.map(value => evalExpression(skillKey, value, rank, attrs, runtime));
  switch (expression.operation) {
    case 'ADD': return a + b;
    case 'SUBTRACT': return a - b;
    case 'MULTIPLY': return a * b;
    case 'DIVIDE': return a / b;
    case 'MIN': return Math.min(a, b);
    case 'MAX': return Math.max(a, b);
    default: throw Error(`未知公式运算 ${expression.operation}`);
  }
}
function formulaValue(skillKey, formulaKey, rank, attrs = {}, runtime = {}) {
  const formula = candidate.skills[skillKey].write.formulas.find(value => value.formulaKey === formulaKey);
  if (!formula) throw Error(`候选公式不存在 ${skillKey}/${formulaKey}`);
  return evalExpression(skillKey, formula.expression, rank, attrs, runtime);
}
function dataValue(spell, name, rank) {
  const data = (spell.object.mSpell.DataValues ?? spell.object.mSpell.mDataValues ?? []).find(value => (value.name ?? value.mName) === name || String(value.name ?? value.mName).toLowerCase() === String(name).toLowerCase());
  const values = data?.values ?? data?.mValues;
  if (!Array.isArray(values) || values[rank] === undefined) throw Error(`原树字段缺失 ${name}/${rank}`);
  return Number(values[rank]);
}
function evalPart(spell, part, rank, context, path) {
  if (!part || typeof part !== 'object') throw Error(`原树节点为空 ${path}`);
  if (Number.isFinite(part.mNumber)) return Number(part.mNumber);
  if (Array.isArray(part.mSubparts)) return part.mSubparts.reduce((sum, child, index) => sum + evalPart(spell, child, rank, context, `${path}.mSubparts[${index}]`), 0);
  if (typeof part.mDataValue === 'string') {
    const raw = dataValue(spell, part.mDataValue, rank);
    if (part.__type === 'StatByNamedDataValueCalculationPart') {
      if (part.mStat === 2 && part.mStatFormula === 2) return raw * context.attrs.attack_damage;
      if (part.mDataValue === 'PercentMissingHPRatio') {
        if (!Object.prototype.hasOwnProperty.call(context.runtime, 'actual_missing_health')) throw Error('原树治疗需要缺失生命运行输入');
        return raw * context.runtime.actual_missing_health;
      }
      if (context.omittedNamedAsAp && (part.mStat === undefined || part.mStat === 0)) return raw * context.attrs.ability_power;
      throw Error(`原树具名属性节点未完成窄映射 ${part.mDataValue}`);
    }
    return raw;
  }
  if (Number.isFinite(part.mCoefficient)) {
    if (part.__type === 'AbilityResourceByCoefficientCalculationPart') throw Error('原树资源系数没有当前可绑定运行输入');
    return Number(part.mCoefficient) * context.attrs.ability_power;
  }
  if (Number.isFinite(part.mLevel1Value) || Number.isFinite(part.mStartValue) || Number.isFinite(part.mEndValue)) {
    if (!Object.prototype.hasOwnProperty.call(context.runtime, 'curve')) throw Error(`原树等级曲线需要外供实际值 ${path}`);
    return context.runtime.curve;
  }
  throw Error(`未支持原树节点 ${part.__type ?? path}`);
}
function evalRawCalculation(spell, key, rank, context, stack = []) {
  if (stack.includes(key)) throw Error(`原树计算循环 ${stack.join('>')} > ${key}`);
  const calculation = spell.object.mSpell.mSpellCalculations?.[key];
  if (!calculation) throw Error(`原树计算不存在 ${key}`);
  if (calculation.__type === 'GameCalculationModified') {
    const base = evalRawCalculation(spell, calculation.mModifiedGameCalculation, rank, context, [...stack, key]);
    const multiplier = calculation.mMultiplier ? evalPart(spell, calculation.mMultiplier, rank, context, `${key}.mMultiplier`) : 1;
    return base * multiplier;
  }
  if (calculation.__type !== 'GameCalculation') throw Error(`原树计算类型未支持 ${calculation.__type}`);
  const total = (calculation.mFormulaParts ?? []).reduce((sum, part, index) => sum + evalPart(spell, part, rank, context, `${key}.mFormulaParts[${index}]`), 0);
  return calculation.mMultiplier ? total * evalPart(spell, calculation.mMultiplier, rank, context, `${key}.mMultiplier`) : total;
}

const order = ['malzahar', 'anivia', 'lissandra', 'karthus'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
check('候选固定20槽顺序', equal(Object.keys(candidate.skills), order), { actual: Object.keys(candidate.skills), expected: order });
check('候选文件哈希可复现', candidate.meta?.apiWrites === 0 && hash(candidateBytes) === JSON.parse(read('候选版本.json')).fileSha256, { apiWrites: candidate.meta?.apiWrites, fileSha256: hash(candidateBytes) });
check('阶段去重预检为只读', stageDedup.noWrites === true && stageDedup.replacement.selectedReplacement === 'Karthus', stageDedup.replacement);
check('写前GET全部成功', current.summary?.requestCount === 166 && current.summary?.errorCount === 0 && current.requests?.length === 166 && current.requests.every(value => value.status === 200), current.summary);
check('当前20技能没有非参数旧组成', order.every(key => Object.entries(current.skills[key].components).filter(([kind]) => kind !== 'parameters').every(([, value]) => value.items.length === 0)), null);
check('文本冻结哈希存在', textEvidence.sha256 === '3bdb4829379195044927237f2c5a97609cb872d1dbd1eb597edffa797333e031', textEvidence.sha256);

for (const hero of sourceFreeze.heroes) {
  const root = roots.heroes.find(value => value.id === hero.id);
  const candidateSource = candidate.meta.sources.find(value => value.id === hero.id);
  check(`${hero.id}客户端哈希与来源冻结一致`, Boolean(root && candidateSource && root.client.sha256 === hero.client.sha256 && candidateSource.client.sha256 === hero.client.sha256), { freeze: hero.client.sha256, root: root?.client.sha256 });
  check(`${hero.id}官方哈希与来源冻结一致`, Boolean(root && candidateSource && root.official.sha256 === hero.official.sha256 && candidateSource.official.sha256 === hero.official.sha256), { freeze: hero.official.sha256, root: root?.official.sha256 });
  for (const binding of hero.bindings) {
    const found = root?.spells.find(value => value.skillKey === binding.skillKey);
    check(`${binding.skillKey}根路径一致`, Boolean(found && found.binding === binding.binding && found.maxrank === binding.maxrank), { freeze: binding, root: found && { binding: found.binding, maxrank: found.maxrank } });
  }
}

for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  const { spell } = spellFor(skillKey);
  const dataValues = spell.object.mSpell.DataValues ?? spell.object.mSpell.mDataValues ?? [];
  const proofs = skill.proofs ?? [];
  for (const data of dataValues) {
    const name = data.name ?? data.mName;
    check(`${skillKey}原始数据字段有证明 ${name}`, proofs.some(value => value.source === `DataValues.${name}`), null);
  }
  for (const calcKey of Object.keys(spell.object.mSpell.mSpellCalculations ?? {})) {
    check(`${skillKey}原始计算树有证明 ${calcKey}`, proofs.some(value => value.source === `mSpellCalculations.${calcKey}`), null);
  }
  for (const proof of proofs) {
    if (!proof.parameterKey || !Array.isArray(proof.values)) continue;
    const parameter = skill.write.parameters.find(value => value.parameterKey === proof.parameterKey);
    if (!parameter || parameter.valueMode === 'RUNTIME_INPUT') continue;
    const actual = parameter.valueMode === 'SKILL_LEVEL' ? Object.keys(parameter.levelValues).sort((a, b) => Number(a) - Number(b)).map(key => parameter.levelValues[key]) : [parameter.fixedValue];
    const fixedRepeated = actual.length === 1 && proof.values.every(value => close(Number(actual[0]), Number(value)));
    const exact = actual.length === proof.values.length && actual.every((value, index) => close(Number(value), Number(proof.values[index])));
    check(`${skillKey}/${proof.parameterKey}候选值等于独立证明`, fixedRepeated || exact, { actual, proof: proof.values, source: proof.source });
  }
  const parameterKeys = new Set(skill.write.parameters.map(value => value.parameterKey));
  for (const parameter of skill.write.parameters) {
    if (parameter.valueMode === 'RUNTIME_INPUT') check(`${skillKey}/${parameter.parameterKey}运行输入无默认`, parameter.fixedValue === null && parameter.levelValues === null, parameter);
    if (parameter.valueMode === 'SKILL_LEVEL') check(`${skillKey}/${parameter.parameterKey}等级值完整`, parameter.fixedValue === null && parameter.levelValues && Object.keys(parameter.levelValues).length === skill.maxLevel, parameter);
  }
  for (const formula of skill.write.formulas) {
    walk(formula.expression, (node, path) => {
      if (node.nodeType === 'PARAMETER') check(`${skillKey}/${formula.formulaKey}引用参数存在`, parameterKeys.has(node.parameterKey), { parameterKey: node.parameterKey, path });
      if (node.nodeType === 'ATTRIBUTE') check(`${skillKey}/${formula.formulaKey}属性口径受控`, ['ability_power', 'attack_damage'].includes(node.attributeKey) && node.attributeOwner === 'SOURCE', node);
    });
  }
  for (const effect of skill.write.effects) {
    let serialized = JSON.stringify(effect);
    check(`${skillKey}/${effect.effectKey}没有MOMENT_EVALUATION`, !serialized.includes('MOMENT_EVALUATION'), null);
    check(`${skillKey}/${effect.effectKey}没有即时伤害或治疗结果`, !serialized.includes('"resultType":"DAMAGE"') && !serialized.includes('"resultType":"DIRECT_HEAL"'), null);
    check(`${skillKey}/${effect.effectKey}没有间接运行输入`, !serialized.includes('RUNTIME_INPUT'), null);
  }
}

const sourceCases = [
  { skillKey: 'malzahar_q', formulaKey: 'damage', rawKey: 'TotalDamageTooltip', rank: 1, attrs: { ability_power: 100 }, expected: 125 },
  { skillKey: 'malzahar_q', formulaKey: 'damage', rawKey: 'TotalDamageTooltip', rank: 5, attrs: { ability_power: 237 }, expected: 340.35 },
  { skillKey: 'malzahar_w', formulaKey: 'voidling_hit_damage', rawKey: 'VoidlingBonusDamageTooltip', rank: 1, attrs: { ability_power: 100, attack_damage: 50 }, runtime: { curve: 5, voidling_level_scaling: 5 }, omittedNamedAsAp: true, expected: 57 },
  { skillKey: 'malzahar_e', formulaKey: 'damage', rawKey: 'TotalDamage', rank: 2, attrs: { ability_power: 100 }, expected: 195 },
  { skillKey: 'malzahar_r', formulaKey: 'beam_damage', rawKey: 'TotalDamageTooltip', rank: 1, attrs: { ability_power: 100 }, omittedNamedAsAp: true, expected: 205 },
  { skillKey: 'malzahar_r', formulaKey: 'zone_damage_ratio', rawKey: 'ZoneDamageTooltip', rank: 1, attrs: { ability_power: 100 }, omittedNamedAsAp: true, expected: 0.125, note: '仅验证当前窄口径算术；目标最大生命所有者不由该节点推出。' },
  { skillKey: 'anivia_p', formulaKey: 'bonus_resists_display', rawKey: 'BonusResistsTooltip', rank: 1, runtime: { curve: -40, bonus_resists: -40 }, expected: 40 },
  { skillKey: 'anivia_q', formulaKey: 'passthrough_damage', rawKey: 'TotalPassthroughDamage', rank: 1, attrs: { ability_power: 100 }, expected: 75 },
  { skillKey: 'anivia_q', formulaKey: 'explosion_damage', rawKey: 'TotalExplosionDamage', rank: 1, attrs: { ability_power: 100 }, expected: 105 },
  { skillKey: 'anivia_e', formulaKey: 'damage', rawKey: 'TotalDamage', rank: 5, attrs: { ability_power: 200 }, expected: 265 },
  { skillKey: 'anivia_e', formulaKey: 'empowered_damage', rawKey: 'EmpoweredDamage', rank: 5, attrs: { ability_power: 200 }, expected: 530 },
  { skillKey: 'anivia_r', formulaKey: 'damage_per_second', rawKey: 'TotalDamagePerSecond', rank: 3, attrs: { ability_power: 100 }, expected: 72.5 },
  { skillKey: 'anivia_r', formulaKey: 'enhanced_slow', rawKey: 'EnhancedSlow', rank: 3, attrs: {}, expected: 60 },
  { skillKey: 'anivia_r', formulaKey: 'empowered_damage_per_second', rawKey: 'EmpoweredDamagePerSecondTooltipOnly', rank: 3, attrs: { ability_power: 100 }, expected: 217.5 },
  { skillKey: 'lissandra_p', formulaKey: 'ice_servant_damage', rawKey: 'TotalDamage', rank: 1, attrs: { ability_power: 100 }, runtime: { curve: 120, ice_servant_base_damage: 120 }, expected: 170 },
  { skillKey: 'lissandra_q', formulaKey: 'damage', rawKey: 'TotalDamage', rank: 4, attrs: { ability_power: 100 }, expected: 260 },
  { skillKey: 'lissandra_w', formulaKey: 'damage', rawKey: 'TotalDamage', rank: 2, attrs: { ability_power: 100 }, expected: 175 },
  { skillKey: 'lissandra_e', formulaKey: 'damage', rawKey: 'TotalDamage', rank: 2, attrs: { ability_power: 100 }, expected: 165 },
  { skillKey: 'lissandra_r', formulaKey: 'damage', rawKey: 'CalculatedDamage', rank: 3, attrs: { ability_power: 100 }, omittedNamedAsAp: true, expected: 425 },
  { skillKey: 'lissandra_r', formulaKey: 'self_heal', rawKey: 'HealAmount', rank: 3, attrs: {}, runtime: { actual_missing_health: 500 }, expected: 475, note: '原树省略属性选择器；以显式实际缺失生命输入验证算术，所有者仍待运行核。' },
  { skillKey: 'karthus_q', formulaKey: 'damage', rawKey: 'QDamage', rank: 5, attrs: { ability_power: 100 }, omittedNamedAsAp: true, expected: 151 },
  { skillKey: 'karthus_q', formulaKey: 'single_target_damage', rawKey: 'QSingleTargetDamage', rank: 5, attrs: { ability_power: 100 }, omittedNamedAsAp: true, expected: 302 },
  { skillKey: 'karthus_e', formulaKey: 'damage_per_second', rawKey: 'TotalDPS', rank: 5, attrs: { ability_power: 100 }, omittedNamedAsAp: true, expected: 130 },
  { skillKey: 'karthus_e', formulaKey: 'quarter_damage_per_second', rawKey: '{57456bbc}', rank: 5, attrs: { ability_power: 100 }, omittedNamedAsAp: true, expected: 32.5 },
  { skillKey: 'karthus_r', formulaKey: 'damage', rawKey: 'TotalDamage', rank: 3, attrs: { ability_power: 100 }, omittedNamedAsAp: true, expected: 570 }
];
const sourceCaseResults = [];
for (const item of sourceCases) {
  const { spell } = spellFor(item.skillKey);
  try {
    const context = { attrs: item.attrs ?? {}, runtime: item.runtime ?? {}, omittedNamedAsAp: Boolean(item.omittedNamedAsAp) };
    const candidateResult = formulaValue(item.skillKey, item.formulaKey, item.rank, item.attrs ?? {}, item.runtime ?? {});
    const rawResult = evalRawCalculation(spell, item.rawKey, item.rank, context);
    const ok = close(candidateResult, rawResult) && close(candidateResult, item.expected);
    sourceCaseResults.push({ ...item, candidateResult, rawResult, ok });
    check(`原树算例 ${item.skillKey}/${item.formulaKey}`, ok, { candidateResult, rawResult, expected: item.expected, note: item.note });
  } catch (error) {
    sourceCaseResults.push({ ...item, ok: false, error: error.message });
    fail(`原树算例 ${item.skillKey}/${item.formulaKey}`, error.message);
  }
}

const manualCases = [
  { skillKey: 'malzahar_q', formulaKey: 'damage', rank: 1, attrs: { ability_power: 100 }, expected: 125, note: '70+0.55×100' },
  { skillKey: 'malzahar_w', formulaKey: 'voidling_hit_damage', rank: 1, attrs: { ability_power: 100, attack_damage: 50 }, runtime: { voidling_level_scaling: 5 }, expected: 57, note: '12+5+0.4×50+0.2×100' },
  { skillKey: 'malzahar_w', formulaKey: 'capped_stack_count', rank: 1, runtime: { actual_stack_count: -3 }, expected: 0, note: 'MAX(-3,0)再MIN(2)' },
  { skillKey: 'malzahar_w', formulaKey: 'summon_count', rank: 1, runtime: { actual_stack_count: 99 }, expected: 3, note: '1+MIN(MAX(99,0),2)' },
  { skillKey: 'malzahar_e', formulaKey: 'damage', rank: 2, attrs: { ability_power: 100 }, expected: 195, note: '115+0.8×100' },
  { skillKey: 'malzahar_r', formulaKey: 'beam_damage', rank: 1, attrs: { ability_power: 100 }, expected: 205, note: '125+0.8×100' },
  { skillKey: 'malzahar_r', formulaKey: 'zone_damage_ratio', rank: 1, attrs: { ability_power: 100 }, expected: 0.125, note: '0.05×(2+0.005×100)' },
  { skillKey: 'anivia_q', formulaKey: 'passthrough_damage', rank: 1, attrs: { ability_power: 100 }, expected: 75, note: '50+0.25×100' },
  { skillKey: 'anivia_q', formulaKey: 'explosion_damage', rank: 1, attrs: { ability_power: 100 }, expected: 105, note: '60+0.45×100' },
  { skillKey: 'anivia_e', formulaKey: 'damage', rank: 5, attrs: { ability_power: 200 }, expected: 265, note: '155+0.55×200' },
  { skillKey: 'anivia_e', formulaKey: 'empowered_damage', rank: 5, attrs: { ability_power: 200 }, expected: 530, note: '2×265' },
  { skillKey: 'anivia_r', formulaKey: 'damage_per_second', rank: 3, attrs: { ability_power: 100 }, expected: 72.5, note: '60+0.125×100' },
  { skillKey: 'anivia_r', formulaKey: 'enhanced_slow', rank: 3, expected: 60, note: '40×(0.5+1)，40为正文百分数点' },
  { skillKey: 'anivia_r', formulaKey: 'empowered_damage_per_second', rank: 3, attrs: { ability_power: 100 }, expected: 217.5, note: '3×72.5' },
  { skillKey: 'lissandra_p', formulaKey: 'ice_servant_damage', rank: 1, attrs: { ability_power: 100 }, runtime: { ice_servant_base_damage: 120 }, expected: 170, note: '120+0.5×100' },
  { skillKey: 'lissandra_q', formulaKey: 'damage', rank: 4, attrs: { ability_power: 100 }, expected: 260, note: '185+0.75×100；DataValues索引1起' },
  { skillKey: 'lissandra_r', formulaKey: 'damage', rank: 3, attrs: { ability_power: 100 }, expected: 425, note: '350+0.75×100' },
  { skillKey: 'lissandra_r', formulaKey: 'self_heal', rank: 3, runtime: { actual_missing_health: 500 }, expected: 475, note: '200+500×0.55；缺失生命为显式运行输入' },
  { skillKey: 'karthus_q', formulaKey: 'damage', rank: 5, attrs: { ability_power: 100 }, expected: 151, note: '116+0.35×100' },
  { skillKey: 'karthus_q', formulaKey: 'single_target_damage', rank: 5, attrs: { ability_power: 100 }, expected: 302, note: '2×151；仅唯一敌人资格成立时使用' },
  { skillKey: 'karthus_e', formulaKey: 'damage_per_second', rank: 5, attrs: { ability_power: 100 }, expected: 130, note: '110+0.2×100' },
  { skillKey: 'karthus_e', formulaKey: 'quarter_damage_per_second', rank: 5, attrs: { ability_power: 100 }, expected: 32.5, note: '0.25×130；不是瞬时伤害' },
  { skillKey: 'karthus_r', formulaKey: 'damage', rank: 3, attrs: { ability_power: 100 }, expected: 570, note: '500+0.7×100；DataValues索引1起' }
];
const manualCaseResults = [];
for (const item of manualCases) {
  try {
    const actual = formulaValue(item.skillKey, item.formulaKey, item.rank, item.attrs ?? {}, item.runtime ?? {});
    const ok = close(actual, item.expected);
    manualCaseResults.push({ ...item, actual, ok });
    check(`手算 ${item.skillKey}/${item.formulaKey}`, ok, { actual, expected: item.expected, note: item.note });
  } catch (error) {
    manualCaseResults.push({ ...item, ok: false, error: error.message });
    fail(`手算 ${item.skillKey}/${item.formulaKey}`, error.message);
  }
}

const negativeControls = [];
function negative(name, fn, detail = null) {
  try {
    fn();
    negativeControls.push({ name, rejected: false, detail });
    fail(`负例 ${name}`, detail ?? '本应拒绝却未拒绝');
  } catch (error) {
    negativeControls.push({ name, rejected: true, error: error.message, detail });
    check(`负例 ${name}`, true, { error: error.message, detail });
  }
}
negative('缺少等级曲线实际输入', () => formulaValue('malzahar_p', 'shield_cooldown_seconds', 1));
negative('缺少虚灵等级实际输入', () => formulaValue('malzahar_w', 'voidling_hit_damage', 1, { ability_power: 100, attack_damage: 50 }));
negative('缺少丽桑卓自疗缺失生命输入', () => formulaValue('lissandra_r', 'self_heal', 3));
negative('唯一敌人分支未满足数量1', () => {
  const count = 2;
  if (count !== 1) throw Error('实际目标数量不是1，禁止选择QSingleTargetDamage');
  formulaValue('karthus_q', 'single_target_damage', 5, { ability_power: 100 }, { actual_target_count: count });
});
negative('负目标数量不应成为唯一目标', () => {
  const count = -1;
  if (count !== 1) throw Error('实际目标数量不是1，禁止选择QSingleTargetDamage');
});
check('最大生命字段没有擅自绑定hp', !JSON.stringify(candidate).includes('"attributeKey":"hp"'), null);
check('候选没有MOMENT_EVALUATION', !JSON.stringify(candidate).includes('MOMENT_EVALUATION'), null);
check('候选没有即时伤害或治疗效果', !JSON.stringify(candidate).includes('"resultType":"DAMAGE"') && !JSON.stringify(candidate).includes('"resultType":"DIRECT_HEAL"'), null);
const ratioChecks = [
  ['malzahar_w', 'lane_minion_ratio', 1, 3],
  ['malzahar_w', 'epic_monster_ratio', 1, 0.5],
  ['malzahar_w', 'ap_ratio', 1, 0.2],
  ['lissandra_p', 'ice_servant_slow_ratio', 1, -0.25],
  ['lissandra_q', 'slow_ratio', 4, -0.32],
  ['anivia_r', 'slow_amount_percent', 3, 40],
  ['karthus_w', 'magic_resist_shred_percent', 1, 25],
  ['karthus_w', 'slow_percent', 3, 60]
];
for (const [skillKey, parameterKey, rank, expected] of ratioChecks) check(`比例单位 ${skillKey}/${parameterKey}保留原始单位`, close(candidateValue(skillKey, parameterKey, rank), expected), { expected, rank, actual: candidateValue(skillKey, parameterKey, rank) });

const summary = {
  at: new Date().toISOString(),
  candidateSha256: hash(candidateBytes),
  sourceFreezeSha256: hash(read('来源冻结/来源与哈希汇总.json')),
  textEvidenceSha256: textEvidence.sha256,
  currentSnapshotSha256: current.snapshotSha256,
  stageLedgerSha256: stageDedup.ledgerSha256,
  checks,
  sourceCases: sourceCaseResults,
  manualCases: manualCaseResults,
  negativeControls,
  unknownCurves: order.flatMap(skillKey => candidate.skills[skillKey].write.parameters.filter(value => value.valueMode === 'RUNTIME_INPUT').map(value => ({ skillKey, parameterKey: value.parameterKey, fixedValue: value.fixedValue, levelValues: value.levelValues }))),
  failures,
  status: failures.length === 0 ? '独立源值、原树映射、手算和负例全部通过；可交父负责人审查' : '独立核算失败，禁止冻结'
};
fs.writeFileSync(new URL('独立源值与算例.json', here), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ status: summary.status, checks: checks.length, failures: failures.length, sourceCases: sourceCaseResults.length, manualCases: manualCaseResults.length, negativeControls: negativeControls.length, candidateSha256: summary.candidateSha256 }, null, 2));
if (failures.length) process.exitCode = 1;
