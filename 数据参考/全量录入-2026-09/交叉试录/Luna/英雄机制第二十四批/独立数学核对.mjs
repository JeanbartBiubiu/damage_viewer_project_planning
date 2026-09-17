import fs from 'node:fs';
import crypto from 'node:crypto';

const here = new URL('./', import.meta.url);
const candidateBytes = fs.readFileSync(new URL('完整候选.json', here));
const candidate = JSON.parse(candidateBytes);
const source = JSON.parse(fs.readFileSync(new URL('来源冻结/主技能数值展开.json', here), 'utf8'));

const heroes = new Map(source.heroes.flatMap(hero => (hero.bindings ?? []).map(skill => [skill.skillKey, skill])));
const candidateSkills = candidate.skills;
const volibearAttackSpeedApCoefficient = Number(heroes.get('volibear_p')?.calculations?.AttackSpeedCalc?.mFormulaParts?.[1]?.mCoefficient);
const results = [];
const failures = [];

function fail(message) {
  failures.push(message);
}

function closeEnough(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-7 * Math.max(1, Math.abs(left), Math.abs(right));
}

function sourceValue(skillKey, dataName, level, scale = 1) {
  const spell = heroes.get(skillKey);
  const entry = spell?.dataValues?.find(item => item.name === dataName);
  const value = entry?.values?.[level];
  if (!Number.isFinite(value)) throw Error('来源数值缺失 ' + skillKey + '/' + dataName + '/' + level);
  return Number(value) * scale;
}

function attrs(overrides = {}) {
  return {
    attack_damage: { TOTAL: overrides.attackDamageTotal ?? 200, BONUS: overrides.attackDamageBonus ?? 100 },
    ability_power: { TOTAL: overrides.abilityPower ?? 120 },
    hp: { TOTAL: overrides.hpTotal ?? 3000, BONUS: overrides.hpBonus ?? 1000 },
    armor: { BONUS: overrides.armorBonus ?? 100 },
    magic_resistance: { BONUS: overrides.mrBonus ?? 80 }
  };
}

function inputCase(name, level, overrides = {}) {
  return {
    name,
    level,
    attrs: attrs(overrides),
    runtime: {
      target_max_health: overrides.targetMaxHealth ?? 2000,
      source_missing_health: overrides.sourceMissingHealth ?? 500,
      chain_lightning_base_damage: overrides.chainLightningBase ?? 60,
      source_bonus_armor: overrides.sourceBonusArmor ?? 100,
      attack_speed_stacks: overrides.attackSpeedStacks ?? 2
    }
  };
}

function parameterValue(skill, parameterKey, testCase) {
  if (Object.hasOwn(testCase.runtime, parameterKey)) return testCase.runtime[parameterKey];
  const parameter = skill.write.parameters.find(item => item.parameterKey === parameterKey);
  if (!parameter) throw Error('参数不存在 ' + skill.skillKey + '/' + parameterKey);
  if (parameter.valueMode === 'FIXED') return parameter.fixedValue;
  if (parameter.valueMode === 'SKILL_LEVEL') return parameter.levelValues?.[String(testCase.level)];
  throw Error('缺少运行输入 ' + skill.skillKey + '/' + parameterKey);
}

function evaluate(expression, skill, testCase) {
  if (!expression || typeof expression !== 'object') throw Error('公式节点为空');
  if (expression.nodeType === 'PARAMETER') return parameterValue(skill, expression.parameterKey, testCase);
  if (expression.nodeType === 'ATTRIBUTE') {
    const owner = expression.attributeOwner;
    if (owner !== 'SOURCE') throw Error('本独立核对未准备非SOURCE属性 ' + owner);
    const group = testCase.attrs[expression.attributeKey];
    const value = group?.[expression.attributeValueKind];
    if (!Number.isFinite(value)) throw Error('缺少属性输入 ' + expression.attributeKey + '/' + expression.attributeValueKind);
    return value;
  }
  if (expression.nodeType !== 'OPERATION' || expression.operands?.length !== 2) throw Error('不支持的公式节点');
  const left = evaluate(expression.operands[0], skill, testCase);
  const right = evaluate(expression.operands[1], skill, testCase);
  switch (expression.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw Error('不支持的公式运算 ' + expression.operation);
  }
}

function data(skillKey, name, testCase, scale = 1) {
  return sourceValue(skillKey, name, testCase.level, scale);
}

function expectedValue(key, testCase) {
  const [skillKey, formulaKey] = key.split('/');
  const a = testCase.attrs;
  const ap = a.ability_power.TOTAL;
  const ad = a.attack_damage.TOTAL;
  const bad = a.attack_damage.BONUS;
  const hp = a.hp.TOTAL;
  const bhp = a.hp.BONUS;
  switch (key) {
    case 'nunu_q/monster_healing':
      return data(skillKey, 'BaseHealing', testCase)
        + data(skillKey, 'PercentageOfBonusHP', testCase) * bhp
        + data(skillKey, 'MonsterHealingAPRatio', testCase) * ap;
    case 'nunu_q/champion_damage':
      return data(skillKey, 'ChampionDamage', testCase)
        + data(skillKey, 'BonusMaxHPDamage', testCase) * bhp
        + data(skillKey, 'ChampDamageAPRatio', testCase) * ap;
    case 'nunu_q/champion_healing':
      return data(skillKey, 'ChampionHealingScalar', testCase) * (
        data(skillKey, 'BaseHealing', testCase)
        + data(skillKey, 'PercentageOfBonusHP', testCase) * bhp
        + data(skillKey, 'MonsterHealingAPRatio', testCase) * ap
      );
    case 'nunu_q/low_health_champion_healing':
      return (1 + data(skillKey, 'LowHealthHealingScalar', testCase)) * (
        data(skillKey, 'ChampionHealingScalar', testCase) * (
          data(skillKey, 'BaseHealing', testCase)
          + data(skillKey, 'PercentageOfBonusHP', testCase) * bhp
          + data(skillKey, 'MonsterHealingAPRatio', testCase) * ap
        )
      );
    case 'nunu_w/maximum_damage':
      return data(skillKey, 'BaseDamage', testCase) + data(skillKey, 'MaximumAPRatio', testCase) * ap;
    case 'nunu_w/minimum_distance_damage':
      return data(skillKey, 'NoImpactDamageScalar', testCase) * (
        data(skillKey, 'BaseDamage', testCase) + data(skillKey, 'MaximumAPRatio', testCase) * ap
      );
    case 'nunu_w/maximum_stun_duration_ms':
      return data(skillKey, 'BaseKnockupDuration', testCase) * 1000
        + data(skillKey, 'AdditionalStunDurationOverTime', testCase) * 1000;
    case 'nunu_e/snowball_damage':
      return data(skillKey, 'BaseDamage', testCase) + 0.12 * ap;
    case 'nunu_e/root_damage':
      return data(skillKey, 'RootDamage', testCase) + 0.8 * ap;
    case 'nunu_r/shield_amount':
      return data(skillKey, 'BaseShieldAmount', testCase)
        + data(skillKey, 'ShieldBonusHealthPercent', testCase) * bhp
        + 1.5 * ap;
    case 'nunu_r/maximum_damage':
      return data(skillKey, 'BaseDamage', testCase) + 3 * ap;
    case 'sejuani_p/frost_armor_amount':
      return data(skillKey, 'BonusArmorBase', testCase) + data(skillKey, 'BonusArmorRatio', testCase) * testCase.runtime.source_bonus_armor;
    case 'sejuani_p/frost_mr_amount':
      return data(skillKey, 'BonusMRBase', testCase) + data(skillKey, 'BonusMRRatio', testCase) * a.magic_resistance.BONUS;
    case 'sejuani_p/armor_break_damage':
      return data(skillKey, 'PercentHPDamageBase', testCase) * testCase.runtime.target_max_health;
    case 'sejuani_q/total_damage':
      return data(skillKey, 'BaseDamage', testCase) + data(skillKey, 'APRatio', testCase) * ap;
    case 'sejuani_w/first_hit_damage':
      return data(skillKey, 'BaseDamageOne', testCase)
        + data(skillKey, 'APRatioOne', testCase) * ap
        + data(skillKey, 'HPRatioOne', testCase) * hp;
    case 'sejuani_w/second_hit_damage':
      return data(skillKey, 'BaseDamageTwo', testCase)
        + data(skillKey, 'APRatioTwo', testCase) * ap
        + data(skillKey, 'HPRatioTwo', testCase) * hp;
    case 'sejuani_e/total_damage':
      return data(skillKey, 'BaseDamage', testCase) + data(skillKey, 'APRatio', testCase) * ap;
    case 'sejuani_r/minor_damage':
      return data(skillKey, 'BaseDamage', testCase) + 0.4 * ap;
    case 'sejuani_r/empowered_damage':
      return data(skillKey, 'EmpoweredBaseDamage', testCase) + 0.8 * ap;
    case 'sion_p/death_attack_extra_damage':
      return data(skillKey, 'PercentMaxHP', testCase) * testCase.runtime.target_max_health;
    case 'sion_q/minimum_damage':
      return data(skillKey, 'LowDamage', testCase) + data(skillKey, 'ADRatioMin', testCase) * ad;
    case 'sion_q/maximum_damage':
      return data(skillKey, 'HighDamage', testCase) + data(skillKey, 'ADRatioMax', testCase) * ad;
    case 'sion_w/total_shield':
      return data(skillKey, 'BaseShield', testCase)
        + data(skillKey, 'ShieldAPRatio', testCase) * ap
        + data(skillKey, 'ShieldPercentHealthTooltip', testCase) * hp;
    case 'sion_w/total_damage':
      return data(skillKey, 'BaseDamage', testCase)
        + data(skillKey, 'DamageAPRatio', testCase) * ap
        + data(skillKey, 'MaxHPDamageRatio', testCase, 0.01) * testCase.runtime.target_max_health;
    case 'sion_e/total_damage':
      return data(skillKey, 'BaseDamage', testCase) + data(skillKey, 'APRatio', testCase) * ap;
    case 'sion_r/minimum_damage':
      return data(skillKey, 'MinDamage', testCase) + 0.6 * bad;
    case 'sion_r/maximum_damage':
      return data(skillKey, 'MaxDamage', testCase) + 1.2 * bad;
    case 'volibear_p/chain_lightning_damage':
      return testCase.runtime.chain_lightning_base_damage + data(skillKey, 'APRatio', testCase) * ap;
    case 'volibear_p/attack_speed_per_stack':
      return data(skillKey, 'PAttackSpeed', testCase) + volibearAttackSpeedApCoefficient * ap;
    case 'volibear_p/attack_speed_total':
      return Math.min(testCase.runtime.attack_speed_stacks, 5) * (
        data(skillKey, 'PAttackSpeed', testCase) + volibearAttackSpeedApCoefficient * ap
      );
    case 'volibear_q/calculated_damage':
      return data(skillKey, 'BaseDamage', testCase) + ad + data(skillKey, 'BonusADRatio', testCase) * bad;
    case 'volibear_w/total_damage':
      return data(skillKey, 'BaseDamage', testCase)
        + 1.1 * ad
        + data(skillKey, 'BonusHealthRatio', testCase) * bhp;
    case 'volibear_w/empowered_damage':
      return (
        data(skillKey, 'W2DamageMultiplier', testCase)
        + data(skillKey, 'W2BonusADDamageMultiplier', testCase) * bad
      ) * (
        data(skillKey, 'BaseDamage', testCase)
        + 1.1 * ad
        + data(skillKey, 'BonusHealthRatio', testCase) * bhp
      );
    case 'volibear_w/empowered_healing':
      return data(skillKey, 'BaseHeal', testCase)
        + data(skillKey, 'HealPercent', testCase) * testCase.runtime.source_missing_health;
    case 'volibear_e/total_damage':
      return data(skillKey, 'BaseDamage', testCase)
        + data(skillKey, 'APRatio', testCase) * ap
        + data(skillKey, 'PercentDamage', testCase) * testCase.runtime.target_max_health;
    case 'volibear_e/shield_value':
      return data(skillKey, 'ShieldAmount', testCase) * hp
        + data(skillKey, 'ShieldAPRatio', testCase) * ap;
    case 'volibear_r/sweet_spot_damage':
      return data(skillKey, 'SweetSpotDamage', testCase) + data(skillKey, 'APRatio', testCase) * ap + 2.5 * bad;
    default:
      throw Error('没有独立来源算式 ' + key);
  }
}

const calcSources = {
  'nunu_q/monster_healing': 'MonsterHealing',
  'nunu_q/champion_damage': 'TotalChampionDamage',
  'nunu_q/champion_healing': 'ChampionHealing',
  'nunu_q/low_health_champion_healing': 'ChampionHealing',
  'nunu_w/maximum_damage': 'MaximumSnowballDamage',
  'nunu_w/minimum_distance_damage': 'NoImpactSnowballDamage',
  'nunu_w/maximum_stun_duration_ms': 'MaximumStunDuration',
  'nunu_e/snowball_damage': 'TotalSnowballDamage',
  'nunu_e/root_damage': 'TotalRootDamage',
  'nunu_r/shield_amount': 'TotalShieldAmount',
  'nunu_r/maximum_damage': 'MaximumDamage',
  'sejuani_p/frost_armor_amount': 'TotalArmorTooltip',
  'sejuani_p/frost_mr_amount': 'TotalMRTooltip',
  'sejuani_p/armor_break_damage': 'PercentHPDamage',
  'sejuani_q/total_damage': 'TotalDamageTooltip',
  'sejuani_w/first_hit_damage': 'FirstHitDamageTooltip',
  'sejuani_w/second_hit_damage': 'SecondHitDamageTooltip',
  'sejuani_e/total_damage': 'TotalDamage',
  'sejuani_r/minor_damage': 'MinorDamageTooltip',
  'sejuani_r/empowered_damage': 'TotalDamageTooltip',
  'sion_q/minimum_damage': 'MinDamageTotal',
  'sion_q/maximum_damage': 'MaxDamageTotal',
  'sion_w/total_shield': 'TotalShield',
  'sion_w/total_damage': 'TotalDamage',
  'sion_e/total_damage': 'TotalDamage',
  'sion_r/minimum_damage': 'MinDamageTotal',
  'sion_r/maximum_damage': 'MaxDamageTotal',
  'volibear_p/chain_lightning_damage': 'ChainLightningDamage',
  'volibear_p/attack_speed_per_stack': 'AttackSpeedCalc',
  'volibear_p/attack_speed_total': 'AttackSpeedCalc',
  'volibear_q/calculated_damage': 'CalculatedDamage',
  'volibear_w/total_damage': 'TotalDamage',
  'volibear_w/empowered_damage': 'EmpoweredDamage',
  'volibear_w/empowered_healing': 'PercentMissingHealthHealingRatio',
  'volibear_e/total_damage': 'CalculatedDamage',
  'volibear_e/shield_value': 'ShieldValue',
  'volibear_r/sweet_spot_damage': 'SweetSpotDamageTooltip'
};

function parameterKeysIn(expression, result = new Set()) {
  if (!expression || typeof expression !== 'object') return result;
  if (expression.nodeType === 'PARAMETER') result.add(expression.parameterKey);
  for (const child of expression.operands ?? []) parameterKeysIn(child, result);
  return result;
}

function checkModifierTrees() {
  const checks = [];
  const nunuW = heroes.get('nunu_w').calculations.NoImpactSnowballDamage;
  checks.push({
    key: 'nunu_w/minimum_distance_damage',
    ok: nunuW?.mMultiplier?.mDataValue === 'NoImpactDamageScalar',
    detail: nunuW?.mMultiplier ?? null
  });
  const nunuR = heroes.get('nunu_r').calculations.MinDamage;
  checks.push({
    key: 'nunu_r/minimum_damage',
    ok: Math.abs(Number(nunuR?.mMultiplier?.mNumber) - 0.5) < 1e-9,
    detail: nunuR?.mMultiplier ?? null
  });
  const volibearP = heroes.get('volibear_p').calculations.AttackSpeedCalc;
  checks.push({
    key: 'volibear_p/attack_speed_per_stack',
    ok: volibearP?.mFormulaParts?.[0]?.mDataValue === 'PAttackSpeed'
      && Math.abs(Number(volibearP?.mFormulaParts?.[1]?.mCoefficient) - 0.0003) < 1e-9,
    detail: volibearP?.mFormulaParts ?? null
  });
  const volibearW = heroes.get('volibear_w').calculations.EmpoweredDamage;
  const subparts = volibearW?.mMultiplier?.mSubparts ?? [];
  checks.push({
    key: 'volibear_w/empowered_damage',
    ok: volibearW?.mModifiedGameCalculation === 'TotalDamage'
      && subparts.some(item => item.mDataValue === 'W2DamageMultiplier')
      && subparts.some(item => item.mDataValue === 'W2BonusADDamageMultiplier'),
    detail: volibearW?.mMultiplier ?? null
  });
  for (const item of checks) if (!item.ok) fail('修饰树未完整保留 ' + item.key);
  return checks;
}

function checkNoRuntimeDefaults() {
  const checks = [];
  for (const [skillKey, skill] of Object.entries(candidateSkills)) {
    for (const parameter of skill.write.parameters.filter(item => item.valueMode === 'RUNTIME_INPUT')) {
      const ok = parameter.fixedValue === null && parameter.levelValues === null;
      checks.push({ skillKey, parameterKey: parameter.parameterKey, ok });
      if (!ok) fail('运行输入出现默认值 ' + skillKey + '/' + parameter.parameterKey);
    }
  }
  return checks;
}

function checkBoundaryInputs() {
  const checks = [];
  const volibear = candidateSkills.volibear_p;
  const totalFormula = volibear.write.formulas.find(item => item.formulaKey === 'attack_speed_total');
  const layerCases = [
    { name: '层数下界0', stacks: 0, expectedStacks: 0 },
    { name: '层数上限5', stacks: 5, expectedStacks: 5 },
    { name: '超过上限7按5封顶', stacks: 7, expectedStacks: 5 }
  ];
  for (const item of layerCases) {
    const testCase = inputCase(item.name, 1, { attackSpeedStacks: item.stacks, abilityPower: 120 });
    const actual = evaluate(totalFormula.expression, volibear, testCase);
    const perStack = parameterValue(volibear, 'attack_speed_per_stack_ratio', testCase)
      + parameterValue(volibear, 'attack_speed_ap_ratio', testCase) * testCase.attrs.ability_power.TOTAL;
    const expected = item.expectedStacks * perStack;
    const ok = closeEnough(actual, expected);
    if (!ok) fail('攻击速度层数边界不一致 ' + item.name + ' actual=' + actual + ' expected=' + expected);
    checks.push({ name: item.name, inputStacks: item.stacks, cappedStacks: item.expectedStacks, actual, expected, ok });
  }

  const nunu = candidateSkills.nunu_q;
  const lowScalar = parameterValue(nunu, 'low_health_healing_scalar', inputCase('低生命参数', 1));
  const multiplier = parameterValue(nunu, 'low_health_champion_multiplier', inputCase('低生命倍率', 1));
  const threshold = parameterValue(nunu, 'low_health_threshold_ratio', inputCase('低生命阈值', 1));
  const ok = closeEnough(multiplier, 1 + lowScalar) && closeEnough(threshold, 0.5);
  if (!ok) fail('低生命回复资格参数未保持1.5倍边界');
  checks.push({ name: '低于50%时回复倍率', threshold, lowHealthScalar: lowScalar, multiplier, expectedMultiplier: 1 + lowScalar, ok });
  return checks;
}

for (const [skillKey, skill] of Object.entries(candidateSkills)) {
  for (const formula of skill.write.formulas) {
    const key = skillKey + '/' + formula.formulaKey;
    const maxLevel = skill.maxLevel;
    const cases = [
      inputCase('输入组A', 1, { attackDamageTotal: 200, attackDamageBonus: 100, abilityPower: 120, hpTotal: 3000, hpBonus: 1000, armorBonus: 100, mrBonus: 80, targetMaxHealth: 2000, sourceMissingHealth: 500, chainLightningBase: 60, sourceBonusArmor: 100, attackSpeedStacks: 0 }),
      inputCase('输入组B', maxLevel, { attackDamageTotal: 350, attackDamageBonus: 220, abilityPower: 260, hpTotal: 5200, hpBonus: 2400, armorBonus: 260, mrBonus: 180, targetMaxHealth: 4200, sourceMissingHealth: 1700, chainLightningBase: 95, sourceBonusArmor: 260, attackSpeedStacks: 5 })
    ];
    const sourceCalc = calcSources[key] ?? null;
    const sourceSpell = heroes.get(skillKey);
    const hasSourceCalc = sourceCalc === null
      ? true
      : Boolean(sourceSpell?.calculations?.[sourceCalc]);
    if (!hasSourceCalc) fail('来源计算树缺失 ' + key + '/' + sourceCalc);
    const dependencies = [...parameterKeysIn(formula.expression)];
    const runtimeDependencies = dependencies.filter(parameterKey =>
      skill.write.parameters.find(item => item.parameterKey === parameterKey)?.valueMode === 'RUNTIME_INPUT'
    );
    const caseResults = [];
    for (const testCase of cases) {
      try {
        const actual = evaluate(formula.expression, skill, testCase);
        const expected = expectedValue(key, testCase);
        const ok = closeEnough(actual, expected);
        if (!ok) fail('算式值不一致 ' + key + '/' + testCase.name + ' actual=' + actual + ' expected=' + expected);
        caseResults.push({ name: testCase.name, level: testCase.level, actual, expected, ok });
      } catch (error) {
        fail('算式求值失败 ' + key + '/' + testCase.name + ': ' + error.message);
        caseResults.push({ name: testCase.name, level: testCase.level, ok: false, error: error.message });
      }
    }
    const missingChecks = [];
    for (const parameterKey of runtimeDependencies) {
      const missingCase = inputCase('缺少' + parameterKey, 1);
      delete missingCase.runtime[parameterKey];
      let rejected = false;
      try {
        evaluate(formula.expression, skill, missingCase);
      } catch {
        rejected = true;
      }
      if (!rejected) fail('缺失运行输入未拒绝 ' + key + '/' + parameterKey);
      missingChecks.push({ parameterKey, rejected });
    }
    results.push({
      skillKey,
      formulaKey: formula.formulaKey,
      sourceCalculation: sourceCalc,
      sourceCalculationPresent: hasSourceCalc,
      runtimeDependencies,
      cases: caseResults,
      missingInputChecks: missingChecks
    });
  }
}

const modifierChecks = checkModifierTrees();
const runtimeNoDefaults = checkNoRuntimeDefaults();
const boundaryChecks = checkBoundaryInputs();
const formulaCount = results.length;
const groups = results.reduce((sum, item) => sum + item.cases.length, 0);
const missingInputChecks = results.reduce((sum, item) => sum + item.missingInputChecks.length, 0);
const result = {
  generatedAt: new Date().toISOString(),
  source: '候选完整候选.json；根绑定客户端16.17/官方16.17.1；独立来源数值展开',
  candidateSha256: crypto.createHash('sha256').update(candidateBytes).digest('hex'),
  formulaCount,
  groups,
  casesPerFormula: 2,
  missingInputChecks,
  runtimeInputCount: runtimeNoDefaults.length,
  failedChecks: failures,
  modifierChecks,
  runtimeNoDefaults,
  boundaryChecks,
  formulas: results,
  passed: failures.length === 0 && formulaCount === 38 && groups === 76 && modifierChecks.every(item => item.ok) && runtimeNoDefaults.every(item => item.ok) && boundaryChecks.every(item => item.ok)
};
fs.writeFileSync(new URL('独立数学核对.json', here), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({
  formulaCount,
  groups,
  casesPerFormula: 2,
  missingInputChecks,
  runtimeInputCount: runtimeNoDefaults.length,
  failedChecks: failures.length,
  passed: result.passed
}, null, 2));
if (!result.passed) process.exitCode = 1;
