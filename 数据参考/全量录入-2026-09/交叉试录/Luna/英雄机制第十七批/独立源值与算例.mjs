import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';

const here = new URL('./', import.meta.url);
const readJson = name => JSON.parse(fs.readFileSync(new URL(name, here), 'utf8'));
const candidateBytes = fs.readFileSync(new URL('完整候选.json', here));
const candidate = JSON.parse(candidateBytes);
const evidence = readJson('根绑定与数值证据.json');
const readOnly = readJson('只读保护与公共参数.json');
const textEvidence = readJson('补充文本证据.json');

const order = ['vladimir', 'swain', 'rumble', 'aurelionsol'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => hero + '_' + slot));
const errors = [];
const checks = [];
const check = (name, ok, detail = null) => {
  checks.push({ name, ok, detail });
  if (!ok) errors.push({ name, detail });
};
const close = (left, right, tolerance = 0.000001) => Math.abs(Number(left) - Number(right)) <= tolerance;
const rawFor = (spell, source) => (spell.object.mSpell.DataValues ?? []).find(item => item.name === source);

function findSource(skillKey) {
  for (const hero of evidence.heroes) {
    const spell = hero.spells.find(item => item.skillKey === skillKey);
    if (spell) return { hero, spell };
  }
  return null;
}

function walk(value, callback, path = '$') {
  if (!value || typeof value !== 'object') return;
  callback(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') walk(child, callback, path + '.' + key);
  }
}

const calculationParameters = new Set();
function parameterValue(parameters, key, skillKey, stack = new Set()) {
  const item = parameters.find(value => value.parameterKey === key);
  if (!item) throw Error(skillKey + ' 缺少参数 ' + key);
  if (item.valueMode === 'RUNTIME_INPUT') {
    if (!Object.hasOwn(runtimeSamples, skillKey + '/' + key) && !Object.hasOwn(runtimeSamples, key)) throw Error('算例缺少明确外供输入 ' + skillKey + '/' + key);
    return runtimeSamples[skillKey + '/' + key] ?? runtimeSamples[key];
  }
  if (item.valueMode === 'FIXED') return Number(item.fixedValue);
  if (item.valueMode === 'SKILL_LEVEL') return Number(item.levelValues['1']);
  throw Error('不支持参数模式 ' + skillKey + '/' + key + '/' + item.valueMode);
}

function evaluate(node, parameters, skillKey) {
  if (node.nodeType === 'PARAMETER') return parameterValue(parameters, node.parameterKey, skillKey);
  if (node.nodeType === 'ATTRIBUTE') {
    const key = node.attributeOwner + ':' + node.attributeKey + ':' + node.attributeValueKind;
    if (!Object.hasOwn(attributeSamples, key)) throw Error('算例缺少属性输入 ' + skillKey + '/' + key);
    return attributeSamples[key];
  }
  if (node.nodeType !== 'OPERATION' || node.operands.length !== 2) throw Error('算例遇到非法公式节点 ' + skillKey);
  const left = evaluate(node.operands[0], parameters, skillKey);
  const right = evaluate(node.operands[1], parameters, skillKey);
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') {
    if (right === 0) throw Error('算例除数为0 ' + skillKey);
    return left / right;
  }
  if (node.operation === 'MIN') return Math.min(left, right);
  if (node.operation === 'MAX') return Math.max(left, right);
  throw Error('算例遇到未知运算 ' + skillKey + '/' + node.operation);
}

const runtimeSamples = {
  'vladimir_p/source_bonus_health_before_passive': 300,
  'vladimir_p/source_ability_power_before_passive': 100,
  'vladimir_q/missing_health_for_empowered_heal': 500,
  'vladimir_q/empowered_heal_base': 100,
  'vladimir_q/q2_move_speed_percent_points': 10,
  'vladimir_w/source_current_hp_for_cost': 800,
  'vladimir_e/source_max_health_for_charge': 2000,
  'swain_p/soul_shard_count': 4,
  'swain_p/source_max_health_for_soul': 2000,
  'swain_r/source_bonus_health_for_swain_r': 300,
  'rumble_p/overheat_attack_base_damage': 20,
  'rumble_p/overheat_attack_speed_ratio': 0.5,
  'rumble_w/source_health_for_shield': 500,
  'aurelionsol_p/stardust_count': 10,
  'aurelionsol_q/stardust_count': 10,
  'aurelionsol_q/target_max_health': 5000,
  'aurelionsol_q/level_based_range': 800,
  'aurelionsol_w/dash_speed_stat': 20,
  'aurelionsol_e/stardust_count': 10,
  'aurelionsol_e/level_based_range': 800,
  'aurelionsol_r/stardust_count': 10
};
const attributeSamples = {
  'SOURCE:ability_power:TOTAL': 100,
  'SOURCE:hp:BONUS': 300,
  'SOURCE:hp:TOTAL': 1000
};

check('候选20技能顺序', equal(Object.keys(candidate.skills), order), { actual: Object.keys(candidate.skills) });
check('来源证据4英雄', evidence.heroes.length === 4, evidence.heroes.map(hero => hero.id));
check('候选业务写入标记为0', candidate.meta?.apiWrites === 0, candidate.meta?.apiWrites);
check('只读证据53请求且无失败写入', readOnly.summary?.requests === 53 && readOnly.summary?.failures === 0 && readOnly.summary?.apiWrites === 0, readOnly.summary);

for (const skillKey of order) {
  const source = findSource(skillKey);
  const skill = candidate.skills[skillKey];
  check(skillKey + '有冻结根绑定', Boolean(source) && skill.source.hero === source.hero.id && skill.source.spellPath === source.spell.binding && skill.source.clientSha256 === source.hero.client.sha256 && skill.source.officialSha256 === source.hero.official.sha256, source ? skill.source : null);
  check(skillKey + '保留当前正文', Boolean(textEvidence.skills?.[skillKey]) && equal(skill.source.currentBoundText, textEvidence.skills[skillKey]), Boolean(skill.source.currentBoundText));
  check(skillKey + '六类只含参数公式效果', skill.write.processes.length === 0 && skill.write.internalStates.length === 0 && skill.write.triggerRules.length === 0, {
    processes: skill.write.processes.length,
    internalStates: skill.write.internalStates.length,
    triggerRules: skill.write.triggerRules.length
  });
  const parameterKeys = new Set(skill.write.parameters.map(item => item.parameterKey));
  check(skillKey + '组成键不重复', parameterKeys.size === skill.write.parameters.length && new Set(skill.write.formulas.map(item => item.formulaKey)).size === skill.write.formulas.length && new Set(skill.write.effects.map(item => item.effectKey)).size === skill.write.effects.length);
  for (const parameter of skill.write.parameters) {
    if (parameter.valueMode === 'RUNTIME_INPUT') {
      check(skillKey + '/' + parameter.parameterKey + '外供参数无默认', parameter.fixedValue === null && parameter.levelValues === null);
    }
  }
  for (const proof of skill.proofs) {
    if (proof.source?.startsWith('DataValues.')) {
      const sourceName = proof.source.slice('DataValues.'.length);
      const rawEntry = source && rawFor(source.spell, sourceName);
      if (proof.sourcePending && rawEntry == null) continue;
      if (rawEntry == null) {
        check(skillKey + '/' + proof.source + '原始字段存在', false, proof);
        continue;
      }
      const raw = rawEntry.values;
      if (Array.isArray(proof.values) && proof.offset != null) {
        const scale = proof.scale ?? 1;
        const expected = raw.slice(proof.offset, proof.offset + proof.values.length).map(value => Math.round(Number(value) * scale * 1000000) / 1000000);
        check(skillKey + '/' + proof.source + '独立实值展开一致', equal(expected, proof.values), { expected, actual: proof.values });
      }
    }
    if (proof.source?.startsWith('mSpellCalculations.')) {
      const calculationKey = proof.source.slice('mSpellCalculations.'.length);
      check(skillKey + '/' + proof.source + '计算树存在', Boolean(source?.spell.object.mSpell.mSpellCalculations?.[calculationKey]), calculationKey);
    }
  }
  for (const formula of skill.write.formulas) {
    const references = [];
    walk(formula.expression, node => {
      if (node.nodeType === 'PARAMETER') references.push(node.parameterKey);
      if (node.nodeType === 'ATTRIBUTE') calculationParameters.add(node.attributeKey);
    });
    check(skillKey + '/' + formula.formulaKey + '引用本技能参数', references.every(key => parameterKeys.has(key)), references.filter(key => !parameterKeys.has(key)));
    try {
      const value = evaluate(formula.expression, skill.write.parameters, skillKey);
      check(skillKey + '/' + formula.formulaKey + '独立算例可求值', Number.isFinite(value), value);
    } catch (error) {
      check(skillKey + '/' + formula.formulaKey + '独立算例可求值', false, String(error));
    }
  }
  for (const effect of skill.write.effects) {
    walk(effect, (node, at) => {
      if (node.resultType) check(skillKey + '/' + effect.effectKey + at + '不含即时伤害治疗', node.resultType !== 'DAMAGE' && node.resultType !== 'DIRECT_HEAL', node.resultType);
      if (node.moment) check(skillKey + '/' + effect.effectKey + at + '不含瞬时求值', node.moment !== 'MOMENT_EVALUATION', node.moment);
      if (node.attributeKey) check(skillKey + '/' + effect.effectKey + at + '属性目录键受保护', ['mana', 'hp', 'move_speed_percent'].includes(node.attributeKey), node.attributeKey);
      if (node.modifierZoneKey) check(skillKey + '/' + effect.effectKey + at + '修正区目录键受保护', node.modifierZoneKey === 'attribute_flat_add', node.modifierZoneKey);
    });
  }
}

const expectedExamples = [
  ['vladimir_p', 'ability_power_from_bonus_health', 10],
  ['vladimir_p', 'bonus_health_from_ability_power', 160],
  ['vladimir_q', 'base_damage', 140],
  ['vladimir_w', 'pool_damage', 125],
  ['vladimir_e', 'min_damage', 95],
  ['vladimir_r', 'damage', 220],
  ['swain_p', 'soul_bonus_max_health', 60],
  ['swain_p', 'soul_heal_amount', 120],
  ['swain_q', 'initial_damage', 105],
  ['swain_w', 'damage', 130],
  ['swain_e', 'secondary_damage', 160],
  ['swain_r', 'damage_per_second', 19],
  ['swain_r', 'healing_per_second', 24.5],
  ['rumble_p', 'overheat_attack_damage', 45],
  ['rumble_q', 'flat_damage', 155],
  ['rumble_w', 'shield_amount', 75],
  ['rumble_e', 'damage', 105],
  ['rumble_r', 'damage_per_second', 155],
  ['aurelionsol_p', 'q_bonus_max_health_damage_ratio', 0.0031],
  ['aurelionsol_p', 'e_execute_threshold_ratio', 0.0526],
  ['aurelionsol_q', 'damage_per_second', 100],
  ['aurelionsol_q', 'bonus_max_health_magic_damage_amount', 15.5],
  ['aurelionsol_w', 'dash_speed', 360],
  ['aurelionsol_e', 'damage_per_second', 22],
  ['aurelionsol_e', 'current_execute_threshold_ratio', 0.0526],
  ['aurelionsol_r', 'damage', 225],
  ['aurelionsol_r', 'skies_descend_damage', 281.25],
  ['aurelionsol_r', 'shockwave_damage', 202.5]
];

function checkExecutionThresholdAt100(skillKey) {
  const skill = candidate.skills[skillKey];
  const formulaKey = skillKey === 'aurelionsol_p' ? 'e_execute_threshold_ratio' : 'current_execute_threshold_ratio';
  const formula = skill.write.formulas?.find(item => item.formulaKey === formulaKey);
  const runtimeKey = skillKey + '/stardust_count';
  const oldCount = runtimeSamples[runtimeKey];
  const source = findSource(skillKey);
  const baseRaw = rawFor(source.spell, 'BaseExecutionThreshold')?.values?.[1];
  const growthRaw = rawFor(source.spell, 'ExecutionGrowthPerBreakpoint')?.values?.[1];
  check(skillKey + '处决基础原值为5百分数点', close(baseRaw, 5), baseRaw);
  check(skillKey + '处决成长原值为0.026百分数点', close(growthRaw, 0.026), growthRaw);
  runtimeSamples[runtimeKey] = 0;
  try {
    const atZero = evaluate(formula.expression, skill.write.parameters, skillKey);
    check(skillKey + '处决0星尘正文单位', close(atZero, 0.05), { actual: atZero, expected: 0.05, renderedPercent: atZero * 100 });
  } catch (error) {
    check(skillKey + '处决0星尘算例可求值', false, String(error));
  }
  runtimeSamples[runtimeKey] = 100;
  try {
    const at100 = evaluate(formula.expression, skill.write.parameters, skillKey);
    check(skillKey + '处决100星尘正文单位', close(at100, 0.076), { actual: at100, expected: 0.076, renderedPercent: at100 * 100 });
  } catch (error) {
    check(skillKey + '处决100星尘算例可求值', false, String(error));
  }
  runtimeSamples[runtimeKey] = oldCount;
}

checkExecutionThresholdAt100('aurelionsol_p');
checkExecutionThresholdAt100('aurelionsol_e');

const examples = [];
for (const [skillKey, formulaKey, expected] of expectedExamples) {
  const skill = candidate.skills[skillKey];
  const formula = skill.write.formulas?.find(item => item.formulaKey === formulaKey);
  if (!formula) {
    check(skillKey + '/' + formulaKey + '算例存在', false);
    continue;
  }
  try {
    const actual = evaluate(formula.expression, skill.parameters ?? skill.write.parameters, skillKey);
    const ok = close(actual, expected);
    check(skillKey + '/' + formulaKey + '代表算例值一致', ok, { actual, expected });
    examples.push({ skillKey, formulaKey, inputs: { ...attributeSamples, ...Object.fromEntries(Object.entries(runtimeSamples).filter(([key]) => key.startsWith(skillKey + '/')).map(([key, value]) => [key.slice(skillKey.length + 1), value])) }, actual, expected, ok });
  } catch (error) {
    check(skillKey + '/' + formulaKey + '代表算例可求值', false, String(error));
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: 'client16.17/official16.17.1',
  candidateSha256: createHash('sha256').update(candidateBytes).digest('hex'),
  skillCount: order.length,
  candidateCounts: Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(kind => [kind, order.reduce((sum, key) => sum + candidate.skills[key].write[kind].length, 0)])),
  reusedPublicParameters: candidate.meta?.reuseReport?.publicParameters?.length ?? 0,
  independentChecks: { total: checks.length, passed: checks.filter(item => item.ok).length, failed: errors.length },
  attributeKeysObserved: [...calculationParameters].sort(),
  explicitExampleInputs: { attributes: attributeSamples, runtime: runtimeSamples },
  examples,
  errors
};
fs.writeFileSync(new URL('独立源值与算例.json', here), JSON.stringify({ summary, checks }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exitCode = 1;
