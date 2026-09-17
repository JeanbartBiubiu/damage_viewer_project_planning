import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(HERE, "..", "hero41-root-entry-20260910");
const DURABLE = path.resolve("C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十一批");
const CANDIDATE_FILE = path.join(HERE, "完整候选.json");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const shaFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-6 * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b))) + 1e-7;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const candidate = readJson(CANDIDATE_FILE);
const binding = readJson(path.join(INPUT, "来源绑定与当前文本.json"));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const rawSpell = (heroId, slot) => sourceSkills[heroId][slot].object.mSpell;
const rawValues = (heroId, slot, name) => {
  const row = (rawSpell(heroId, slot).DataValues || []).find(item => item.name === name);
  assert(row && Array.isArray(row.values), `缺少原始数据值 ${heroId}/${slot}/${name}`);
  return row.values;
};
const rawAt = (heroId, slot, name, index) => rawValues(heroId, slot, name)[index];
const rawCalc = (heroId, slot, name) => {
  const value = rawSpell(heroId, slot).mSpellCalculations?.[name];
  assert(value, `缺少原始计算树 ${heroId}/${slot}/${name}`);
  return value;
};
const rawPart = (heroId, slot, calcName, index = 0) => rawCalc(heroId, slot, calcName).mFormulaParts[index];
const coefficient = (heroId, slot, calcName, index = 1) => {
  const part = rawPart(heroId, slot, calcName, index);
  assert(typeof part?.mCoefficient === "number", `原始树没有系数 ${heroId}/${slot}/${calcName}/${index}`);
  return part.mCoefficient;
};
const multiplier = (heroId, slot, calcName) => {
  const value = rawCalc(heroId, slot, calcName).mMultiplier?.mNumber;
  assert(typeof value === "number", `原始树没有根乘数 ${heroId}/${slot}/${calcName}`);
  return value;
};
const toMs = seconds => Math.round(Number(seconds) * 1000);
const sourceSkill = key => candidate.skills[key];
const parameter = (key, parameterKey) => {
  const item = sourceSkill(key).write.parameters.find(value => value.parameterKey === parameterKey);
  assert(item, `候选缺少参数 ${key}/${parameterKey}`);
  return item;
};
const attrKey = (owner, key, kind) => `${owner}.${key}.${kind}`;
const resolveParameter = (key, parameterKey, context) => {
  const item = parameter(key, parameterKey);
  if (item.valueMode === "FIXED") return item.fixedValue;
  if (item.valueMode === "SKILL_LEVEL") {
    const value = item.levelValues?.[String(context.skillLevel)];
    assert(value !== undefined, `缺少技能等级输入 ${key}/${parameterKey}`);
    return value;
  }
  if (item.valueMode === "CHARACTER_LEVEL") {
    const value = item.levelValues?.[String(context.characterLevel)];
    assert(value !== undefined, `缺少角色等级输入 ${key}/${parameterKey}`);
    return value;
  }
  if (item.valueMode === "RUNTIME_INPUT") {
    const value = context.runtime?.[parameterKey];
    assert(value !== undefined && value !== null, `缺少运行输入 ${key}/${parameterKey}`);
    return value;
  }
  throw new Error(`未知参数模式 ${key}/${parameterKey}/${item.valueMode}`);
};
const evaluate = (key, node, context, formulaStack = []) => {
  assert(node && typeof node === "object", `空表达式 ${key}`);
  if (node.nodeType === "PARAMETER") return resolveParameter(key, node.parameterKey, context);
  if (node.nodeType === "ATTRIBUTE") {
    const value = context.attributes?.[attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind)];
    assert(value !== undefined && value !== null, `缺少属性输入 ${key}/${attrKey(node.attributeOwner, node.attributeKey, node.attributeValueKind)}`);
    return value;
  }
  if (node.nodeType === "FORMULA") {
    assert(!formulaStack.includes(node.formulaKey), `公式循环 ${key}/${node.formulaKey}`);
    const item = sourceSkill(key).write.formulas.find(formula => formula.formulaKey === node.formulaKey);
    assert(item, `候选缺少被引用公式 ${key}/${node.formulaKey}`);
    return evaluate(key, item.expression, context, [...formulaStack, node.formulaKey]);
  }
  if (node.nodeType === "OPERATION") {
    assert(Array.isArray(node.operands) && node.operands.length === 2, `运算不是二元 ${key}/${node.operation}`);
    const left = evaluate(key, node.operands[0], context, formulaStack);
    const right = evaluate(key, node.operands[1], context, formulaStack);
    if (node.operation === "ADD") return Number(left) + Number(right);
    if (node.operation === "MULTIPLY") return Number(left) * Number(right);
    throw new Error(`不支持的运算 ${key}/${node.operation}`);
  }
  throw new Error(`不支持的表达式节点 ${key}/${node.nodeType}`);
};
const formula = (key, formulaKey) => {
  const item = sourceSkill(key).write.formulas.find(value => value.formulaKey === formulaKey);
  assert(item, `候选缺少公式 ${key}/${formulaKey}`);
  return item;
};
const context = ({ skillLevel = 1, characterLevel = 1, ap = 100, ad = 100, targetHp = 1000, runtime = {} } = {}) => ({
  skillLevel, characterLevel, runtime,
  attributes: {
    [attrKey("SOURCE", "ability_power", "TOTAL")]: ap,
    [attrKey("SOURCE", "attack_damage", "TOTAL")]: ad,
    [attrKey("TARGET", "hp", "TOTAL")]: targetHp,
  },
});
const rawBreakpoint = (part, level) => {
  assert(typeof part?.mLevel1Value === "number", "断点原树缺少1级值");
  let value = part.mLevel1Value;
  const points = (part.mBreakpoints || []).slice().sort((a, b) => a.mLevel - b.mLevel);
  for (let current = 2; current <= level; current += 1) {
    const slope = points.filter(point => point.mLevel <= current - 1 && typeof point.mBonusPerLevelAtAndAfter === "number").at(-1);
    value += slope ? slope.mBonusPerLevelAtAndAfter : (part.mInitialBonusPerLevel || 0);
    for (const point of points) if (point.mLevel === current) value += point.mAdditionalBonusAtThisLevel || 0;
  }
  return value;
};
const interpolation = (part, level) => {
  assert(typeof part?.mStartValue === "number" && typeof part?.mEndValue === "number", "插值原树缺少端点");
  return part.mStartValue + (part.mEndValue - part.mStartValue) * (level - 1) / 17;
};
const rawExpected = (key, formulaKey, c) => {
  const [hero, slot] = key === "milio_p" ? ["Milio", "P"] : key === "bard_p" ? ["Bard", "P"] : key === "bard_q" ? ["Bard", "Q"] : key === "bard_w" ? ["Bard", "W"] : key === "milio_q" ? ["Milio", "Q"] : key === "milio_w" ? ["Milio", "W"] : key === "milio_e" ? ["Milio", "E"] : key === "milio_r" ? ["Milio", "R"] : key === "rakan_p" ? ["Rakan", "P"] : key === "rakan_q" ? ["Rakan", "Q"] : key === "rakan_w" ? ["Rakan", "W"] : key === "rakan_r" ? ["Rakan", "R"] : key === "renata_p" ? ["Renata", "P"] : key === "renata_q" ? ["Renata", "Q"] : key === "renata_w" ? ["Renata", "W"] : ["Renata", "E"];
  const level = c.skillLevel;
  const ap = c.attributes[attrKey("SOURCE", "ability_power", "TOTAL")];
  const ad = c.attributes[attrKey("SOURCE", "attack_damage", "TOTAL")];
  const targetHp = c.attributes[attrKey("TARGET", "hp", "TOTAL")];
  if (key === "bard_p") {
    if (formulaKey === "meep_damage_no_chime") return rawAt(hero, slot, "BaseMeepDamage", 0) + rawAt(hero, slot, "MeepAPRatio", 1) * ap;
    const tree = formulaKey === "chimes_for_slow_upgrade" ? "ChimesForSlowUpgrade" : formulaKey === "chimes_for_splash_damage_upgrade" ? "ChimesForSplashDamageUpgrade" : "ChimesForSplashAreaUpgrade";
    return rawAt(hero, slot, "ChimesPerUpgrade", 1) * multiplier(hero, slot, tree);
  }
  if (key === "bard_q") return rawAt(hero, slot, "BaseDamage", level) + rawAt(hero, slot, "APRatio", level) * ap;
  if (key === "bard_w") {
    if (formulaKey === "initial_heal") return rawAt(hero, slot, "HealingMult", level) * (rawAt(hero, slot, "MinimumHeal", level) + rawAt(hero, slot, "APRatio_Min", level) * ap);
    if (formulaKey === "maximum_heal") return rawAt(hero, slot, "HealingMult", level) * (rawAt(hero, slot, "MaximumHeal", level) + rawAt(hero, slot, "APRatio_Max", level) * ap);
    return rawAt(hero, slot, "MoveSpeed_Base", level) + rawAt(hero, slot, "MoveSpeed_Ratio", level) * ap;
  }
  if (key === "milio_p") {
    if (formulaKey === "ad_burst_damage") return rawBreakpoint(rawPart(hero, slot, "ADBurstRatio"), c.characterLevel) * ad;
    const rawBase = c.runtime.burn_base_damage_at_character_level;
    const low = rawAt(hero, slot, "BaseDamageStart", 1);
    const high = rawAt(hero, slot, "BaseDamageEnd", 1);
    assert(near(rawBase, low) || near(rawBase, high), "米利欧灼烧运行输入必须来自原始端点");
    return rawBase + coefficient(hero, slot, "BurnDamage", 1) * ap;
  }
  if (key === "milio_q") {
    if (formulaKey === "damage") return rawAt(hero, slot, "FallDamage", level) + coefficient(hero, slot, "Damage", 1) * ap;
    return rawAt(hero, slot, "SlowAmount", level) + coefficient(hero, slot, "SlowAmountPercent", 1) * ap;
  }
  if (key === "milio_w") {
    if (formulaKey === "range_percent") return rawAt(hero, slot, "RangePctIncrease", level);
    return rawAt(hero, slot, "TotalHealingOverTime", level) + rawAt(hero, slot, "HealAPRatio", level) * ap;
  }
  if (key === "milio_e") return rawAt(hero, slot, "ShieldBase", level) + coefficient(hero, slot, "ShieldCalc", 1) * ap;
  if (key === "milio_r") return rawAt(hero, slot, "HealBase", level) + coefficient(hero, slot, "HealCalc", 1) * ap;
  if (key === "rakan_p") {
    if (formulaKey === "total_shield") {
      const base = c.runtime.shield_base_at_character_level;
      const expectedBase = interpolation(rawPart(hero, slot, "TotalShield", 0), c.characterLevel);
      assert(near(base, expectedBase), "洛P护盾角色等级输入不符合原始插值端点");
      return expectedBase + coefficient(hero, slot, "TotalShield", 1) * ap;
    }
    const cooldown = c.runtime.shield_cooldown_at_character_level;
    const expectedCooldown = rawBreakpoint(rawPart(hero, slot, "ShieldCooldown", 0), c.characterLevel);
    assert(near(cooldown, expectedCooldown), "洛P护盾冷却角色等级输入不符合原始断点树");
    return expectedCooldown;
  }
  if (key === "rakan_q") {
    if (formulaKey === "total_damage") return rawAt(hero, slot, "BaseDamage", level) + rawAt(hero, slot, "DamageAPRatio", level) * ap;
    const base = c.runtime.self_heal_base_at_character_level;
    const expectedBase = interpolation(rawPart(hero, slot, "TotalHeal", 0), c.characterLevel);
    assert(near(base, expectedBase), "洛Q治疗角色等级输入不符合原始插值端点");
    return expectedBase + rawAt(hero, slot, "HealAPRatio", level) * ap;
  }
  if (key === "rakan_w") return rawAt(hero, slot, "BaseDamage", level) + coefficient(hero, slot, "TotalDamage", 1) * ap;
  if (key === "rakan_r") return rawAt(hero, slot, "BaseDamage", level) + coefficient(hero, slot, "TotalDamageTooltip", 1) * ap;
  if (key === "renata_p") {
    const base = c.runtime.self_amp_base_at_character_level;
    const expectedBase = rawBreakpoint(rawPart(hero, slot, "PercentAmpCalcSelf", 0), c.characterLevel);
    assert(near(base, expectedBase), "烈娜塔P角色等级输入不符合原始断点树");
    const ratio = expectedBase + rawAt(hero, slot, "APToPercentRatio", level) * ap;
    return formulaKey === "self_mark_damage" ? ratio * targetHp : ratio;
  }
  if (key === "renata_q") return rawAt(hero, slot, "Damage", level) + rawAt(hero, slot, "APRatio", level) * ap;
  if (key === "renata_w") {
    const dataName = formulaKey.includes("attack_speed") ? "BonusAttackSpeed" : "BonusMoveSpeed";
    const treeName = formulaKey.includes("final_") ? (dataName === "BonusAttackSpeed" ? "FinalASCalc" : "FinalMSCalc") : (dataName === "BonusAttackSpeed" ? "ASCalc" : "MSCalc");
    return multiplier(hero, slot, treeName) * (rawAt(hero, slot, dataName, level) + rawAt(hero, slot, "APToPercentRatio", level) * ap);
  }
  if (key === "renata_e") {
    if (formulaKey === "total_damage") return rawAt(hero, slot, "Damage", level) + coefficient(hero, slot, "TotalDamage", 1) * ap;
    return rawAt(hero, slot, "ShieldValue", level) + rawAt(hero, slot, "ShieldAPRatio", level) * ap;
  }
  throw new Error(`缺少独立原始期望 ${key}/${formulaKey}`);
};

const scenarios = {
  bard_p: {
    meep_damage_no_chime: [context({ ap: 40 }), context({ ap: 400 })],
    chimes_for_slow_upgrade: [context(), context({ ap: 400 })],
    chimes_for_splash_damage_upgrade: [context(), context({ ap: 400 })],
    chimes_for_splash_area_upgrade: [context(), context({ ap: 400 })],
  },
  bard_q: { total_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 350 })] },
  bard_w: {
    initial_heal: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 350 })],
    maximum_heal: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 350 })],
    move_speed: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 350 })],
  },
  milio_p: {
    ad_burst_damage: [context({ characterLevel: 1, ad: 80, ap: 50 }), context({ characterLevel: 18, ad: 300, ap: 400 })],
    burn_damage: [context({ ap: 50, runtime: { burn_base_damage_at_character_level: rawAt("Milio", "P", "BaseDamageStart", 1) } }), context({ ap: 400, runtime: { burn_base_damage_at_character_level: rawAt("Milio", "P", "BaseDamageEnd", 1) } })],
  },
  milio_q: {
    damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    slow_amount: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
  },
  milio_w: {
    range_percent: [context({ skillLevel: 1 }), context({ skillLevel: 5, ap: 400 })],
    healing_over_time: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
  },
  milio_e: { shield_value: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })] },
  milio_r: { heal_value: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })] },
  rakan_p: {
    total_shield: [context({ characterLevel: 1, ap: 50, runtime: { shield_base_at_character_level: interpolation(rawPart("Rakan", "P", "TotalShield", 0), 1), shield_cooldown_at_character_level: rawBreakpoint(rawPart("Rakan", "P", "ShieldCooldown", 0), 1) } }), context({ characterLevel: 18, ap: 400, runtime: { shield_base_at_character_level: interpolation(rawPart("Rakan", "P", "TotalShield", 0), 18), shield_cooldown_at_character_level: rawBreakpoint(rawPart("Rakan", "P", "ShieldCooldown", 0), 18) } })],
    shield_cooldown: [context({ characterLevel: 1, runtime: { shield_base_at_character_level: interpolation(rawPart("Rakan", "P", "TotalShield", 0), 1), shield_cooldown_at_character_level: rawBreakpoint(rawPart("Rakan", "P", "ShieldCooldown", 0), 1) } }), context({ characterLevel: 18, runtime: { shield_base_at_character_level: interpolation(rawPart("Rakan", "P", "TotalShield", 0), 18), shield_cooldown_at_character_level: rawBreakpoint(rawPart("Rakan", "P", "ShieldCooldown", 0), 18) } })],
  },
  rakan_q: {
    total_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    total_heal: [context({ characterLevel: 1, ap: 50, runtime: { self_heal_base_at_character_level: interpolation(rawPart("Rakan", "Q", "TotalHeal", 0), 1) } }), context({ characterLevel: 18, ap: 400, runtime: { self_heal_base_at_character_level: interpolation(rawPart("Rakan", "Q", "TotalHeal", 0), 18) } })],
  },
  rakan_w: { total_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })] },
  rakan_r: { total_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 3, ap: 400 })] },
  renata_p: {
    self_percent_amp: [context({ characterLevel: 1, ap: 50, runtime: { self_amp_base_at_character_level: rawBreakpoint(rawPart("Renata", "P", "PercentAmpCalcSelf", 0), 1) } }), context({ characterLevel: 18, ap: 400, runtime: { self_amp_base_at_character_level: rawBreakpoint(rawPart("Renata", "P", "PercentAmpCalcSelf", 0), 18) } })],
    self_mark_damage: [context({ characterLevel: 1, ap: 50, targetHp: 500, runtime: { self_amp_base_at_character_level: rawBreakpoint(rawPart("Renata", "P", "PercentAmpCalcSelf", 0), 1) } }), context({ characterLevel: 18, ap: 400, targetHp: 2500, runtime: { self_amp_base_at_character_level: rawBreakpoint(rawPart("Renata", "P", "PercentAmpCalcSelf", 0), 18) } })],
  },
  renata_q: { total_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })] },
  renata_w: {
    initial_attack_speed: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    initial_move_speed: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    final_attack_speed: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    final_move_speed: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
  },
  renata_e: {
    total_damage: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
    shield_value: [context({ skillLevel: 1, ap: 50 }), context({ skillLevel: 5, ap: 400 })],
  },
};

const levelSourceMap = {
  bard_q: { base_damage: "BaseDamage", slow_duration_ms: "SlowDuration", stun_duration_ms: "StunDuration" },
  bard_w: { move_speed_base_ratio: "MoveSpeed_Base", minimum_heal: "MinimumHeal", maximum_heal: "MaximumHeal" },
  bard_e: { door_duration_ms: "DoorDuration", friendly_move_speed_bonus_percent: "FriendlyMovementBonusPercentage", base_travel_speed: "BaseTravelSpeed" },
  bard_r: { stasis_duration_ms: "RStasisDuration" },
  milio_q: { damage_base: "FallDamage", slow_base_ratio: "SlowAmount" },
  milio_w: { range_increase_ratio: "RangePctIncrease", total_heal_base: "TotalHealingOverTime" },
  milio_e: { move_speed_ratio: "MoveSpeedAmount", shield_base: "ShieldBase" },
  milio_r: { heal_base: "HealBase" },
  rakan_q: { damage_base: "BaseDamage" },
  rakan_w: { damage_base: "BaseDamage", knockup_duration_ms: "KnockupDuration" },
  rakan_r: { damage_base: "BaseDamage", charm_duration_ms: "CharmDuration" },
  renata_q: { damage_base: "Damage" },
  renata_w: { duration_ms: "Duration", bonus_attack_speed_points: "BonusAttackSpeed", bonus_move_speed_points: "BonusMoveSpeed" },
  renata_e: { damage_base: "Damage", shield_base: "ShieldValue" },
  renata_r: { berserk_duration_ms: "BerserkDuration" },
};
const heroSlot = key => key === "bard_p" ? ["Bard", "P"] : key === "bard_q" ? ["Bard", "Q"] : key === "bard_w" ? ["Bard", "W"] : key === "bard_e" ? ["Bard", "E"] : key === "bard_r" ? ["Bard", "R"] : key === "milio_p" ? ["Milio", "P"] : key === "milio_q" ? ["Milio", "Q"] : key === "milio_w" ? ["Milio", "W"] : key === "milio_e" ? ["Milio", "E"] : key === "milio_r" ? ["Milio", "R"] : key === "rakan_p" ? ["Rakan", "P"] : key === "rakan_q" ? ["Rakan", "Q"] : key === "rakan_w" ? ["Rakan", "W"] : key === "rakan_r" ? ["Rakan", "R"] : key === "renata_p" ? ["Renata", "P"] : key === "renata_q" ? ["Renata", "Q"] : key === "renata_w" ? ["Renata", "W"] : key === "renata_r" ? ["Renata", "R"] : ["Renata", "E"];

const structural = { formulaCount: 0, binaryOperations: 0, invalidOperations: 0, missingReferences: 0, forbiddenResults: 0, runtimeWithoutDefault: 0, integerValues: 0, invalidIntegerValues: 0 };
const walk = (key, node) => {
  if (node.nodeType === "PARAMETER") {
    const item = parameter(key, node.parameterKey);
    if (item.valueMode === "RUNTIME_INPUT") {
      structural.runtimeWithoutDefault += Number(item.fixedValue === null && item.levelValues === null);
      assert(item.fixedValue === null && item.levelValues === null, `运行输入带默认 ${key}/${node.parameterKey}`);
    }
    return;
  }
  if (node.nodeType === "ATTRIBUTE") return;
  if (node.nodeType === "FORMULA") {
    formula(key, node.formulaKey);
    return;
  }
  if (node.nodeType === "OPERATION") {
    if (Array.isArray(node.operands) && node.operands.length === 2) structural.binaryOperations += 1;
    else { structural.invalidOperations += 1; throw new Error(`不是二元运算 ${key}`); }
    walk(key, node.operands[0]); walk(key, node.operands[1]);
    return;
  }
  throw new Error(`未知表达式节点 ${key}/${node.nodeType}`);
};
for (const key of candidate.order) {
  const skill = sourceSkill(key);
  structural.formulaCount += skill.write.formulas.length;
  for (const item of skill.write.formulas) walk(key, item.expression);
  for (const item of skill.write.parameters) {
    if (item.valueType === "INTEGER") {
      const values = item.valueMode === "FIXED" ? [item.fixedValue] : item.valueMode === "SKILL_LEVEL" || item.valueMode === "CHARACTER_LEVEL" ? Object.values(item.levelValues || {}) : [];
      for (const value of values) {
        structural.integerValues += 1;
        if (!Number.isInteger(value) || value < 0) structural.invalidIntegerValues += 1;
      }
    }
  }
  for (const effect of skill.write.effects) for (const result of effect.results || []) {
    if (["DAMAGE", "DIRECT_HEAL", "MOMENT_EVALUATION"].includes(result.resultType)) structural.forbiddenResults += 1;
    if (result.valueRule?.value?.kind === "FORMULA") formula(key, result.valueRule.value.formulaKey);
  }
}
assert(structural.formulaCount === 31, `公式数量不是31：${structural.formulaCount}`);
assert(structural.invalidIntegerValues === 0, `存在非法整数参数：${structural.invalidIntegerValues}`);
assert(structural.forbiddenResults === 0, "存在禁止结果类型");

const sourceChecks = { levelArrays: 0, levelArrayFailures: [], characterBreakpoints: 0, characterBreakpointFailures: [], rawFormulaCoefficients: 0 };
for (const [key, mapping] of Object.entries(levelSourceMap)) {
  const [hero, slot] = heroSlot(key);
  for (const [parameterKey, rawName] of Object.entries(mapping)) {
    const item = parameter(key, parameterKey);
    const raw = rawValues(hero, slot, rawName);
    const expected = {};
    const max = sourceSkill(key).maxLevel;
    for (let level = 1; level <= max; level += 1) expected[String(level)] = parameterKey.endsWith("_ms") ? toMs(raw[level]) : raw[level];
    for (const level of Object.keys(expected)) if (!near(item.levelValues?.[level], expected[level])) sourceChecks.levelArrayFailures.push({ key, parameterKey, level, actual: item.levelValues?.[level], expected: expected[level] });
    sourceChecks.levelArrays += 1;
  }
}
const charChecks = [
  ["milio_p", "ad_burst_ratio", "ADBurstRatio"],
];
for (const [key, parameterKey, calcName] of charChecks) {
  const [hero, slot] = heroSlot(key);
  const item = parameter(key, parameterKey);
  const part = rawPart(hero, slot, calcName, 0);
  for (const level of [1, 6, 9, 18]) {
    const expected = rawBreakpoint(part, level);
    if (!near(item.levelValues?.[String(level)], expected)) sourceChecks.characterBreakpointFailures.push({ key, parameterKey, level, actual: item.levelValues?.[String(level)], expected });
    sourceChecks.characterBreakpoints += 1;
  }
}
for (const [hero, slot, calcName, index] of [
  ["Bard", "P", "MeepDamageNoChime", 1], ["Bard", "W", "InitialHeal", 1], ["Bard", "W", "MaxHeal", 1], ["Bard", "W", "Calc_MoveSpeed", 1],
  ["Milio", "P", "BurnDamage", 1], ["Milio", "Q", "Damage", 1], ["Milio", "Q", "SlowAmountPercent", 1], ["Milio", "W", "HealingOverTime", 1], ["Milio", "E", "ShieldCalc", 1], ["Milio", "R", "HealCalc", 1],
  ["Rakan", "P", "TotalShield", 1], ["Rakan", "Q", "TotalDamage", 1], ["Rakan", "Q", "TotalHeal", 1], ["Rakan", "W", "TotalDamage", 1], ["Rakan", "R", "TotalDamageTooltip", 1],
  ["Renata", "P", "PercentAmpCalcSelf", 1], ["Renata", "Q", "TotalDamage", 1], ["Renata", "W", "ASCalc", null], ["Renata", "W", "MSCalc", null], ["Renata", "W", "FinalASCalc", null], ["Renata", "W", "FinalMSCalc", null], ["Renata", "E", "TotalDamage", 1], ["Renata", "E", "ShieldCalc", 1],
]) {
  const part = index === null ? rawCalc(hero, slot, calcName).mMultiplier : rawPart(hero, slot, calcName, index);
  assert(index === null ? typeof part?.mNumber === "number" : (typeof part?.mCoefficient === "number" || typeof part?.mDataValue === "string"), `原始系数结构异常 ${hero}/${slot}/${calcName}`);
  sourceChecks.rawFormulaCoefficients += 1;
}
assert(sourceChecks.levelArrayFailures.length === 0, `等级数组起点或单位错误：${JSON.stringify(sourceChecks.levelArrayFailures)}`);
assert(sourceChecks.characterBreakpointFailures.length === 0, `角色断点错误：${JSON.stringify(sourceChecks.characterBreakpointFailures)}`);

const results = [];
let caseCount = 0;
for (const key of candidate.order) {
  for (const item of sourceSkill(key).write.formulas) {
    const cases = scenarios[key]?.[item.formulaKey];
    assert(Array.isArray(cases) && cases.length >= 2, `公式场景少于2组 ${key}/${item.formulaKey}`);
    for (let index = 0; index < cases.length; index += 1) {
      const c = cases[index];
      const actual = evaluate(key, item.expression, c);
      const expected = rawExpected(key, item.formulaKey, c);
      assert(Number.isFinite(actual) && Number.isFinite(expected), `公式结果非有限 ${key}/${item.formulaKey}`);
      const pass = near(actual, expected);
      results.push({ skillKey: key, formulaKey: item.formulaKey, caseIndex: index + 1, skillLevel: c.skillLevel, characterLevel: c.characterLevel, actual, expected, pass });
      assert(pass, `公式实算不符 ${key}/${item.formulaKey}/${index + 1}: ${actual} !== ${expected}`);
      caseCount += 1;
    }
  }
}
const runtimeFormulaRefs = [];
for (const key of candidate.order) for (const item of sourceSkill(key).write.formulas) {
  const runtimeParams = item.expression && [];
  const collect = node => {
    if (!node) return;
    if (node.nodeType === "PARAMETER") {
      const p = parameter(key, node.parameterKey);
      if (p.valueMode === "RUNTIME_INPUT" && !runtimeFormulaRefs.some(ref => ref.key === key && ref.formulaKey === item.formulaKey && ref.parameterKey === node.parameterKey)) runtimeFormulaRefs.push({ key, formulaKey: item.formulaKey, parameterKey: node.parameterKey });
    } else if (node.nodeType === "OPERATION") for (const operand of node.operands) collect(operand);
  };
  collect(item.expression);
}
const missingInputChecks = [];
for (const ref of runtimeFormulaRefs) {
  const valid = scenarios[ref.key][ref.formulaKey][0];
  const missingRuntime = { ...(valid.runtime || {}) };
  delete missingRuntime[ref.parameterKey];
  let rejected = false;
  try { evaluate(ref.key, formula(ref.key, ref.formulaKey).expression, { ...valid, runtime: missingRuntime }); } catch { rejected = true; }
  assert(rejected, `缺值没有拒绝 ${ref.key}/${ref.formulaKey}/${ref.parameterKey}`);
  missingInputChecks.push({ ...ref, rejected });
}

const report = {
  generatedAt: new Date().toISOString(),
  status: "通过",
  candidateMathReady: true,
  businessMathReady: false,
  note: "候选阶段独立数学；未调用业务接口，实际业务回读后才能标记业务数学通过。",
  candidateSha256: shaFile(CANDIDATE_FILE),
  revision: candidate.meta.revision,
  formulaCount: structural.formulaCount,
  caseCount,
  expectedCasesPerFormula: 2,
  results,
  missingInputCases: missingInputChecks,
  missingInputCaseCount: missingInputChecks.length,
  sourceChecks,
  structural,
  sourceFiles: {
    inputBinding: shaFile(path.join(INPUT, "来源绑定与当前文本.json")),
    inputVersion: shaFile(path.join(INPUT, "输入版本.json")),
    candidate: shaFile(CANDIDATE_FILE),
  },
  apiCalls: 0,
  apiWrites: 0,
};
const reportBytes = JSON.stringify(report, null, 2) + "\n";
const artifactReport = path.join(HERE, "独立数学核算.json");
fs.writeFileSync(artifactReport, reportBytes, "utf8");
fs.mkdirSync(DURABLE, { recursive: true });
const durableScript = path.join(DURABLE, "独立数学核算.mjs");
const scriptBytes = fs.readFileSync(fileURLToPath(import.meta.url));
fs.writeFileSync(durableScript, scriptBytes);
const durableReport = path.join(DURABLE, "独立数学核算.json");
fs.writeFileSync(durableReport, reportBytes, "utf8");
assert(shaFile(artifactReport) === shaFile(durableReport), "数学报告持久目录字节不一致");
assert(shaFile(fileURLToPath(import.meta.url)) === shaFile(durableScript), "数学脚本持久目录字节不一致");
console.log(JSON.stringify({ status: report.status, candidateMathReady: report.candidateMathReady, businessMathReady: report.businessMathReady, candidateSha256: report.candidateSha256, formulaCount: report.formulaCount, caseCount: report.caseCount, missingInputCaseCount: report.missingInputCaseCount, sourceChecks: report.sourceChecks, structural: report.structural, reportSha256: shaFile(artifactReport), scriptSha256: shaFile(fileURLToPath(import.meta.url)), apiCalls: 0, apiWrites: 0 }, null, 2));
