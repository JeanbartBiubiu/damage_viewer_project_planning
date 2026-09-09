import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero29-root-entry-20260909");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第二十九批");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = file => hash(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
};
const writeBytes = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
const requireValue = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : "：" + JSON.stringify(detail)));
};
const close = (a, b, factor = 1e-6) =>
  Math.abs(Number(a) - Number(b)) <= factor * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));

const inputVersionPath = path.join(inputDir, "输入版本.json");
const sourceBindingPath = path.join(inputDir, "来源绑定与当前文本.json");
const sourceNotePath = path.join(inputDir, "主负责人源值核对说明.md");
const protectionPath = path.join(inputDir, "参考资料", "当前10槽保护快照.json");
const publicPath = path.join(inputDir, "参考资料", "公共参数复用清单.json");
const inputVersion = readJson(inputVersionPath);
const source = readJson(sourceBindingPath);
const protection = readJson(protectionPath);
const publicReuse = readJson(publicPath);
const frozenHashes = {
  inputVersion: fileHash(inputVersionPath),
  sourceBinding: fileHash(sourceBindingPath),
  sourceNote: fileHash(sourceNotePath),
  protection: fileHash(protectionPath),
  publicReuse: fileHash(publicPath),
};
requireValue(inputVersion.apiWrites === 0, "输入版本已有业务写入");
requireValue(inputVersion.GETs === 99, "保护GET数量不是99", inputVersion.GETs);
requireValue(source.clientVersion === "16.17" && source.officialVersion === "16.17.1", "来源版本不符");
requireValue(Array.isArray(publicReuse) && publicReuse.length === 11, "公共参数复用数量不是11");
requireValue(Array.isArray(protection.requests) && protection.requests.length === 99, "保护快照数量不是99");
const attributeSnapshot = protection.requests.find(item => item.route === "/attributes");
requireValue(attributeSnapshot?.status === 200 && attributeSnapshot.data?.items?.some(item => item.attributeKey === "energy" && item.status === "ENABLED"),
  "冻结属性目录没有可用能量键");

const skillKeys = [
  "ornn_p", "ornn_q", "ornn_w", "ornn_e", "ornn_r",
  "shen_p", "shen_q", "shen_w", "shen_e", "shen_r",
];
const heroOf = skillKey => skillKey.startsWith("ornn_") ? "Ornn" : "Shen";
const slotOf = skillKey => skillKey.slice(-1).toUpperCase();
const spellIndex = { Q: 0, W: 1, E: 2, R: 3 };
const sourceEntry = skillKey => {
  const hero = source.heroes.find(item => item.id === heroOf(skillKey));
  const bound = hero?.skills?.find(item => item.slot === slotOf(skillKey));
  const summary = hero?.source?.skills?.find(item => item.slot === slotOf(skillKey));
  requireValue(hero && bound && summary, "来源绑定技能缺失", skillKey);
  return { hero, bound, summary, spell: bound.object.mSpell };
};
const sourceSpell = skillKey => sourceEntry(skillKey).spell;
const maxLevel = skillKey => Number(sourceEntry(skillKey).summary.officialMaxRank);
const sourceData = (skillKey, dataName, rank) => {
  const item = sourceSpell(skillKey).DataValues?.find(value => value.name === dataName);
  requireValue(item && Array.isArray(item.values), "来源DataValues缺失", { skillKey, dataName });
  const value = item.values[rank];
  requireValue(typeof value === "number" && Number.isFinite(value), "来源等级值缺失", { skillKey, dataName, rank });
  return value;
};
const sourceCalc = (skillKey, calculation) => {
  const value = sourceSpell(skillKey).mSpellCalculations?.[calculation];
  requireValue(value, "来源计算树缺失", { skillKey, calculation });
  return value;
};
const sourcePart = (skillKey, calculation, index) => {
  const value = sourceCalc(skillKey, calculation).mFormulaParts?.[index];
  requireValue(value, "来源计算树分段缺失", { skillKey, calculation, index });
  return value;
};
const official = {};
for (const heroId of ["Ornn", "Shen"]) {
  const file = path.join(inputDir, "参考资料", "官方中文", heroId + ".json");
  official[heroId] = readJson(file).data[heroId];
}
const officialSpell = skillKey => official[heroOf(skillKey)].spells[spellIndex[slotOf(skillKey)]];
const sourceCooldown = (skillKey, rank) => {
  const values = sourceSpell(skillKey).cooldownTime;
  requireValue(Array.isArray(values) && typeof values[rank] === "number", "来源冷却数组缺失", { skillKey, rank });
  return values[rank] * 1000;
};
const officialCooldown = (skillKey, index) => {
  const value = officialSpell(skillKey).cooldown?.[index];
  requireValue(typeof value === "number" && Number.isFinite(value), "官方冷却数组缺失", { skillKey, index });
  return value * 1000;
};
const officialCost = (skillKey, index) => {
  const value = officialSpell(skillKey).cost?.[index];
  requireValue(typeof value === "number" && Number.isFinite(value), "官方消耗数组缺失", { skillKey, index });
  return value;
};

const baselineByRoute = new Map(protection.requests.map(item => [item.route, item]));
const stripIdentity = value => {
  if (Array.isArray(value)) return value.map(stripIdentity);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["gameId", "skillKey", "createdAt", "updatedAt"].includes(key))
      .map(([key, child]) => [key, stripIdentity(child)]));
  }
  return value;
};
const publicSet = new Set(publicReuse.map(item => item.skillKey + "|" + item.parameterKey));
const publicBodies = new Map();
for (const item of publicReuse) {
  const route = "/skills/" + item.skillKey + "/parameters/" + item.parameterKey;
  const frozen = baselineByRoute.get(route);
  requireValue(frozen?.status === 200 && frozen.data, "公共参数保护详情缺失", route);
  const body = stripIdentity(frozen.data);
  if (item.parameterKey === "cooldown_ms") {
    requireValue(body.valueMode === "SKILL_LEVEL" && body.levelValues, "公共冷却不是等级参数", route);
    const actual = Object.values(body.levelValues).map(Number);
    const expected = officialSpell(item.skillKey).cooldown.map(value => value * 1000);
    requireValue(actual.length === expected.length && actual.every((value, index) => close(value, expected[index], 1e-6)),
      "公共冷却与官方等级0数组不一致", { route, actual, expected });
    const sourceValues = [];
    for (let rank = 1; rank <= maxLevel(item.skillKey); rank += 1) sourceValues.push(sourceCooldown(item.skillKey, rank));
    requireValue(sourceValues.length === expected.length && sourceValues.every((value, index) => close(value, expected[index], 1e-6)),
      "来源冷却索引1与官方索引0不一致", { route, sourceValues, expected });
  }
  if (item.parameterKey === "mana_cost") {
    const expected = officialSpell(item.skillKey).cost;
    if (body.valueMode === "SKILL_LEVEL") {
      const actual = Object.values(body.levelValues ?? {}).map(Number);
      requireValue(actual.length === expected.length && actual.every((value, index) => close(value, expected[index], 1e-6)),
        "公共资源消耗与官方索引0不一致", { route, actual, expected });
    } else {
      requireValue(body.valueMode === "FIXED" && close(Number(body.fixedValue), expected[0], 1e-6),
        "公共固定资源消耗与官方索引0不一致", { route, actual: body.fixedValue, expected: expected[0] });
    }
    const sourceValues = sourceSpell(item.skillKey).mana ?? sourceSpell(item.skillKey).manaValues;
    requireValue(Array.isArray(sourceValues) && sourceValues.length >= expected.length &&
      expected.every((value, index) => close(Number(sourceValues[index]), Number(value), 1e-6)),
      "来源资源消耗与官方索引0不一致", { route, sourceValues, expected });
  }
  publicBodies.set(item.skillKey + "|" + item.parameterKey, body);
}

const parameter = (parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder,
});
const fixed = (key, name, type, value, description, sortOrder) => parameter(key, name, type, "FIXED", value, null, description, sortOrder);
const levels = (key, name, type, values, description, sortOrder) => parameter(
  key, name, type, "SKILL_LEVEL", null, Object.fromEntries(values.map((value, index) => [String(index + 1), value])), description, sortOrder,
);
const runtime = (key, name, type, description, sortOrder) => parameter(key, name, type, "RUNTIME_INPUT", null, null, description, sortOrder);
const characterLevels = (key, name, type, values, description, sortOrder) => parameter(
  key, name, type, "CHARACTER_LEVEL", null, Object.fromEntries(values.map((value, index) => [String(index + 1), value])), description, sortOrder,
);
const paramNode = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const attrNode = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const op = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const add = (left, right) => op("ADD", left, right);
const multiply = (left, right) => op("MULTIPLY", left, right);
const max = (left, right) => op("MAX", left, right);
const add3 = (one, two, three) => add(add(one, two), three);
const multiplyRatioByAttribute = (ratio, attribute) => multiply(ratio, attribute);
const resourceEffect = (effectKey, parameterKey, attributeKey, operation, name, description) => ({
  effectKey,
  name,
  description,
  sortOrder: 10,
  lifecycle: null,
  results: [{
    resultKey: "resource",
    name,
    resultType: "RESOURCE_CHANGE",
    target: "SOURCE",
    sortOrder: 10,
    description: null,
    spellShieldBlockScope: null,
    lifecycleBehavior: null,
    valueRule: {
      value: { kind: "PARAMETER", parameterKey },
      fixedMultiplier: 1,
      fixedMinValue: 0,
      fixedMaxValue: null,
    },
    detail: { attributeKey, operation },
  }],
});
const manaEffect = parameterKey => resourceEffect(
  "mana_cost", parameterKey, "mana", "CONSUME", "施放法力消耗",
  "仅记录当前技能已证的法力基础消耗；实际扣除时点与施放资格尚未接线。",
);
const energyCostEffect = parameterKey => resourceEffect(
  "energy_cost", parameterKey, "energy", "CONSUME", "施放能量消耗",
  "当前属性目录已存在energy键；仅记录已证能量消耗，实际扣除时点与施放资格尚未接线。",
);
const energyRefundEffect = parameterKey => resourceEffect(
  "energy_refund", parameterKey, "energy", "RESTORE", "造成伤害能量回复",
  "当前属性目录已存在energy键；只保存当前等级实际输入对应的回复量，命中条件事件未自动触发。",
);
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const attrs = {
  sourceHpBonus: attrNode("SOURCE", "hp", "BONUS"),
  sourceHpTotal: attrNode("SOURCE", "hp", "TOTAL"),
  sourceAp: attrNode("SOURCE", "ability_power", "TOTAL"),
  sourceTotalAd: attrNode("SOURCE", "attack_damage", "TOTAL"),
  sourceMrBonus: attrNode("SOURCE", "magic_resistance", "BONUS"),
  targetHpTotal: attrNode("TARGET", "hp", "TOTAL"),
};

const definitions = {
  ornn_p: {
    pending: [
      "自身生命、护甲和魔抗的应用前基准必须由实际输入提供，避免把已含被动增益的最终值再次放大。",
      "杰作升级数量没有本轮可用的完整上限；仅要求非负整数，不把13级解锁或经济操作写成事件。",
      "当前模式1的10%基础加成和每件杰作4%加成保留，升级后的装备属性接线另待处理。",
    ],
    excluded: ["商店、铸造经济、队友装备升级及匿名90到10等级曲线不录入。"],
    parameters: [
      fixed("base_stat_amp_ratio", "基础属性增幅比例", "DECIMAL", 0.1, "当前模式1正文明确生命、护甲和魔抗提高10%；根DataValues.BaseStatAmp为0.1。", 10),
      fixed("additional_masterwork_stat_amp_ratio", "每件杰作额外属性增幅比例", "DECIMAL", 0.04, "当前模式1正文明确每完成一件杰作额外提高4%；根DataValues.AdditionalMythicStatAmp为0.04。", 20),
      runtime("actual_masterwork_count", "已完成杰作数量", "INTEGER", "实际战前已完成的杰作数量；来源没有给出本轮允许的完整上限，实际输入无默认且必须为非负整数。", 30),
      runtime("actual_source_hp_before_ornn_passive", "奥恩被动应用前来源生命", "DECIMAL", "应用10%加成前的来源生命基准；不能使用已经包含奥恩被动的最终生命，实际输入无默认。", 40),
      runtime("actual_source_armor_before_ornn_passive", "奥恩被动应用前来源护甲", "DECIMAL", "应用10%加成前的来源护甲基准；不能使用已经包含奥恩被动的最终护甲，实际输入无默认。", 50),
      runtime("actual_source_magic_resistance_before_ornn_passive", "奥恩被动应用前来源魔抗", "DECIMAL", "应用10%加成前的来源魔抗基准；不能使用已经包含奥恩被动的最终魔抗，实际输入无默认。", 60),
    ],
    formulas: [
      formula("stat_amplification_ratio", "活体锻炉当前属性增幅比例",
        add(paramNode("base_stat_amp_ratio"), multiply(paramNode("additional_masterwork_stat_amp_ratio"), paramNode("actual_masterwork_count"))),
        "当前属性增幅比例=10%+4%×已完成杰作数量；数量不设置本轮上限。", 10),
      formula("bonus_health", "活体锻炉额外生命",
        multiply(add(paramNode("base_stat_amp_ratio"), multiply(paramNode("additional_masterwork_stat_amp_ratio"), paramNode("actual_masterwork_count"))),
          paramNode("actual_source_hp_before_ornn_passive")),
        "额外生命=(10%+4%×杰作数量)×被动应用前来源生命。", 20),
      formula("bonus_armor", "活体锻炉额外护甲",
        multiply(add(paramNode("base_stat_amp_ratio"), multiply(paramNode("additional_masterwork_stat_amp_ratio"), paramNode("actual_masterwork_count"))),
          paramNode("actual_source_armor_before_ornn_passive")),
        "额外护甲=(10%+4%×杰作数量)×被动应用前来源护甲。", 30),
      formula("bonus_magic_resistance", "活体锻炉额外魔抗",
        multiply(add(paramNode("base_stat_amp_ratio"), multiply(paramNode("additional_masterwork_stat_amp_ratio"), paramNode("actual_masterwork_count"))),
          paramNode("actual_source_magic_resistance_before_ornn_passive")),
        "额外魔抗=(10%+4%×杰作数量)×被动应用前来源魔抗。", 40),
    ],
    effects: [],
  },
  ornn_q: {
    pending: ["施法250/300毫秒来源冲突，使用无默认实际输入；柱形成延迟、短暂停滞、碰撞和减速应用时点未接线。"],
    excluded: ["不把火山柱实体交互写成自主召唤物或伤害事件；仅保留柱持续时间和技能伤害公式。"],
    parameters: [
      runtime("actual_cast_time_ms", "实际施法时间（毫秒）", "INTEGER", "客户端与官方来源分别给出250毫秒和300毫秒，不能任选固定值；实际输入无默认。", 10),
      levels("base_damage", "基础物理伤害", "INTEGER", [20, 45, 70, 95, 120], "当前根DataValues.BaseDamage取技能等级1至5。", 20),
      fixed("attack_damage_ratio", "总攻击力倍率", "DECIMAL", 1.1, "当前根TotalDamage的StatByCoefficient为1.1，根说明按总攻击力取值。", 30),
      fixed("slow_percent_points", "减速百分数点", "INTEGER", 40, "当前根DataValues.SlowAmount为40；应用资格与时点未接线。", 40),
      fixed("slow_duration_ms", "减速持续（毫秒）", "INTEGER", 2000, "当前根DataValues.SlowDuration为2秒，单位换算为毫秒。", 50),
      fixed("pillar_duration_ms", "火山柱持续（毫秒）", "INTEGER", 4000, "当前根DataValues.PillarDuration为4秒，仅作为地形交互时长参数。", 60),
    ],
    formulas: [formula("physical_damage", "火山突堑物理伤害",
      add(paramNode("base_damage"), multiply(paramNode("attack_damage_ratio"), attrs.sourceTotalAd)),
      "TotalDamage=BaseDamage+1.1×来源总攻击力。", 10)],
    effects: [manaEffect("mana_cost")],
  },
  ornn_w: {
    pending: [
      "每次火焰取生命值的阶段、首末时点和五次间隔未接线；这里只表达单次下限、目标最大生命比例和五次算术总量。",
      "易碎额外伤害比例只有9%至17%根插值端点，等级求值未证，实际比例无默认输入。",
    ],
    excluded: ["BaseDamageTooltip和野怪上限为当前正文未消费或非英雄分支；不把35%自减速挂成效果。"],
    parameters: [
      fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", 250, "当前正文明确施法250毫秒；不表示每次火焰命中时点。", 10),
      levels("minimum_damage_per_tick", "每次伤害下限", "INTEGER", [16, 26, 36, 46, 56], "当前根DataValues.MinimumDamagePerTick取技能等级1至5；英雄分支下限。", 20),
      levels("target_max_health_ratio_per_tick", "每次目标最大生命伤害比例", "DECIMAL", [0.024, 0.026, 0.028, 0.03, 0.032], "当前根DataValues.PercentHPPerTick取索引1至5，原值2.4%至3.2%，直接录入比例。", 30),
      levels("max_percent_health_total_percent_points", "五次最大生命百分数点", "INTEGER", [12, 13, 14, 15, 16], "当前正文直接消费MaxPercentHPPerTickTooltip，根DataValues取技能等级1至5的12/13/14/15/16；仅作正文显示值，不替代单次MAX公式。", 40),
      fixed("tick_count", "火焰次数", "INTEGER", 5, "当前根DataValues.NumberOfTicks为5；不假定实际命中间隔。", 50),
      fixed("breath_duration_ms", "火焰持续（毫秒）", "INTEGER", 750, "当前根DataValues.BreathDuration为0.75秒，单位换算为毫秒。", 60),
      runtime("actual_brittle_extra_magic_ratio", "实际等级易碎额外魔法伤害比例", "DECIMAL", "根BrittlePercentMaxHPCalc只有9%至17%角色等级端点，等级求值未证；实际比例无默认。", 70),
      fixed("brittle_ratio_start_endpoint", "易碎比例起点", "DECIMAL", 0.09, "根BrittlePercentMaxHPCalc起点为9%；仅保留来源端点，不替代实际等级输入。", 80),
      fixed("brittle_ratio_end_endpoint", "易碎比例终点", "DECIMAL", 0.17, "根BrittlePercentMaxHPCalc终点为17%；仅保留来源端点，不替代实际等级输入。", 90),
      fixed("brittle_duration_ms", "易碎持续（毫秒）", "INTEGER", 3000, "当前根DataValues.BrittleDuration为3秒；下一次定身增伤资格未接线。", 100),
      fixed("brittle_next_immobilize_bonus_percent_points", "下一次定身伤害增加百分数点", "INTEGER", 30, "当前正文明确下一次定身持续时间增加30%；仅保留端点，不创建定身事件。", 110),
    ],
    formulas: [
      formula("minimum_damage_total", "风箱炎息五次伤害下限总量",
        multiply(paramNode("minimum_damage_per_tick"), paramNode("tick_count")),
        "来源TotalMinimumDamage=每次英雄伤害下限×5。", 10),
      formula("damage_per_tick", "风箱炎息单次英雄伤害",
        max(paramNode("minimum_damage_per_tick"), multiply(paramNode("target_max_health_ratio_per_tick"), attrs.targetHpTotal)),
        "单次英雄伤害=MAX(每次下限，目标最大生命×每次比例)。", 20),
      formula("five_tick_damage_total", "风箱炎息五次英雄伤害总量",
        multiply(paramNode("tick_count"), max(paramNode("minimum_damage_per_tick"), multiply(paramNode("target_max_health_ratio_per_tick"), attrs.targetHpTotal))),
        "五次算术总量=5×单次MAX值；不表示实际命中时序。", 30),
      formula("brittle_extra_magic_damage", "易碎下一次定身额外魔法伤害",
        multiply(paramNode("actual_brittle_extra_magic_ratio"), attrs.targetHpTotal),
        "实际等级易碎比例×目标最大生命；比例无默认且不把自身普攻的触发条件重复写入。", 40),
    ],
    effects: [manaEffect("mana_cost")],
  },
  ornn_e: {
    pending: [
      "施法250/350毫秒来源冲突，使用无默认实际输入。",
      "mStat1的额外护甲映射缺少本轮窄证，先以应用前实际护甲输入；mStat6按同版窄口径使用来源额外魔抗属性。",
      "冲锋资格、地形判定、柱碰撞和同一英雄仅受一次冲击波伤害的事件时序未接线；保留唯一敌人一次伤害范围。",
    ],
    excluded: ["不按ArmorRatio字段名猜最终护甲，不创建第二次同敌伤害或冲锋过程。"],
    parameters: [
      runtime("actual_cast_time_ms", "实际施法时间（毫秒）", "INTEGER", "客户端与官方来源分别给出250毫秒和350毫秒，不能任选固定值；实际输入无默认。", 10),
      levels("base_damage", "基础物理伤害", "INTEGER", [80, 125, 170, 215, 260], "当前根DataValues.BaseDamage取技能等级1至5。", 20),
      fixed("armor_ratio", "护甲倍率", "DECIMAL", 0.4, "当前根TotalDamage第二段绑定ArmorRatio=0.4；mStat1/formula2的输入口径单独保留。", 30),
      fixed("magic_resistance_ratio", "魔抗倍率", "DECIMAL", 0.4, "当前根TotalDamage第三段绑定MRRatio=0.4；同版窄口径按来源额外魔抗属性读取。", 40),
      runtime("actual_source_armor_for_ornn_e", "奥恩E实际来源护甲基准", "DECIMAL", "mStat1/formula2的额外护甲映射尚缺明确窄证，先由实际输入提供应用前护甲基准，无默认。", 50),
      fixed("knockup_duration_ms", "撞地形击飞持续（毫秒）", "INTEGER", 1250, "当前根DataValues.KnockupDuration为1.25秒，单位换算为毫秒。", 60),
    ],
    formulas: [formula("physical_damage", "炽烈冲锋物理伤害",
      add3(paramNode("base_damage"), multiply(paramNode("armor_ratio"), paramNode("actual_source_armor_for_ornn_e")),
        multiply(paramNode("magic_resistance_ratio"), attrs.sourceMrBonus)),
      "TotalDamage=BaseDamage+0.4×实际应用前护甲基准+0.4×来源额外魔抗；不把字段名当最终属性。", 10)],
    effects: [manaEffect("mana_cost")],
  },
  ornn_r: {
    pending: [
      "施法250/500毫秒来源冲突，使用无默认实际输入；冲击波飞行和目标资格未接线。",
      "客户端减速持续2000毫秒与官方英文正文3000毫秒冲突，分开记录两个来源值，不任选统一时长。",
    ],
    excluded: ["第三目标分配、后续英雄500毫秒击飞和完整元素碰撞过程排除；本轮唯一敌人保留来回两程。"],
    parameters: [
      runtime("actual_cast_time_ms", "实际施法时间（毫秒）", "INTEGER", "客户端与官方来源分别给出250毫秒和500毫秒，不能任选固定值；实际输入无默认。", 10),
      levels("base_damage_per_pass", "每程基础魔法伤害", "INTEGER", [125, 175, 225], "当前根DataValues.RBaseDamage取技能等级1至3。", 20),
      fixed("ap_ratio", "法强倍率", "DECIMAL", 0.2, "当前根RDamageCalc的RRatio为0.2，按来源总法强读取。", 30),
      levels("slow_percent_points", "首程减速百分数点", "INTEGER", [40, 50, 60], "当前根DataValues.RSlowPercentBasePreMath取技能等级1至3，30/40/50原数组索引1起转为正文40/50/60。", 40),
      fixed("client_slow_duration_ms", "客户端首程减速持续（毫秒）", "INTEGER", 2000, "当前根DataValues.RSlowDuration为2秒；与官方英文正文3000毫秒冲突，单独保留。", 50),
      fixed("official_text_slow_duration_ms", "官方正文首程减速持续（毫秒）", "INTEGER", 3000, "官方英文正文把减速持续写入3000毫秒语句；中文没有明确时长，单独保留冲突来源。", 60),
      fixed("brittle_duration_ms_per_pass", "每程易碎持续（毫秒）", "INTEGER", 3000, "当前根DataValues.BrittleDurationTOOLTIPONLY为3秒，单位换算为毫秒。", 70),
      fixed("second_pass_first_enemy_knockup_ms", "第二程首个英雄击飞持续（毫秒）", "INTEGER", 1000, "当前根DataValues.RStunDuration为1秒；第三目标缩短分支排除。", 80),
      fixed("pass_count_same_enemy", "唯一敌人可受伤程数", "INTEGER", 2, "本轮范围保留来回两程对同一唯一敌人的两次伤害和易碎；不扩展第三目标分配。", 90),
    ],
    formulas: [
      formula("magic_damage_per_pass", "熔铸之神的召唤单程魔法伤害",
        add(paramNode("base_damage_per_pass"), multiply(paramNode("ap_ratio"), attrs.sourceAp)),
        "RDamageCalc=RBaseDamage+0.2×来源总法强；每程独立可命中唯一敌人。", 10),
      formula("magic_damage_same_enemy_total", "熔铸之神的召唤唯一敌人两程总魔法伤害",
        multiply(paramNode("pass_count_same_enemy"), add(paramNode("base_damage_per_pass"), multiply(paramNode("ap_ratio"), attrs.sourceAp))),
        "唯一敌人两程总量=2×单程伤害；不包含第三目标分配。", 20),
    ],
    effects: [manaEffect("mana_cost")],
  },
  shen_p: {
    pending: [
      "当前ShieldValue默认分支的角色等级基础护盾值和冷却缩短值均使用无默认实际输入；不按显示精度把冷却曲线造为整数毫秒数组。",
      "指定buff条件的1.3倍护盾端点保留，但不假定慎劫任务已完成，也不创建技能触发事件。",
    ],
    excluded: ["另一个47至101加0.07额外生命的非当前分支不混入；队友收益和护盾触发资格待接。"],
    parameters: [
      runtime("actual_base_shield_value", "实际等级基础护盾值", "DECIMAL", "当前ShieldValue默认分支的基础项为角色等级47至120，完整等级曲线未证，实际输入无默认。", 10),
      fixed("base_shield_level1_endpoint", "基础护盾等级1端点", "INTEGER", 47, "当前默认分支根树角色等级起点47；仅保留端点，不替代实际等级输入。", 20),
      fixed("base_shield_level_max_endpoint", "基础护盾高等级端点", "INTEGER", 120, "当前默认分支根树角色等级终点120；仅保留端点，不替代实际等级输入。", 30),
      fixed("bonus_health_ratio", "额外生命护盾倍率", "DECIMAL", 0.13, "当前ShieldValue默认根树mStat12/formula2的mCoefficient为0.13；另一0.07分支排除。", 40),
      fixed("shield_duration_ms", "护盾持续（毫秒）", "INTEGER", 2500, "当前根DataValues.ShieldDuration为2.5秒，单位换算为毫秒。", 50),
      fixed("passive_cooldown_ms", "被动基础冷却（毫秒）", "INTEGER", 11000, "当前根DataValues.ShieldCooldown为11秒，单位换算为毫秒。", 60),
      runtime("actual_shield_cooldown_reduction_ms", "实际等级每次技能命中缩短被动冷却（毫秒）", "DECIMAL", "根ShieldCooldownReduction为4秒、每级0.235秒且19级后0.125秒，完整角色等级求值和毫秒归整未证，实际输入无默认。", 70),
      fixed("conditional_shield_multiplier", "指定条件护盾倍率", "DECIMAL", 1.3, "具名条件分支根树使用ShenZedQuestShieldMultiplier=1.3；不默认条件成立。", 80),
    ],
    formulas: [
      formula("default_shield_value", "忍法气合盾默认护盾值",
        add(paramNode("actual_base_shield_value"), multiply(paramNode("bonus_health_ratio"), attrs.sourceHpBonus)),
        "当前ShieldValue默认分支=实际等级基础护盾值+0.13×来源额外生命。", 10),
      formula("conditional_shield_value", "忍法气合盾指定条件护盾值",
        multiply(paramNode("conditional_shield_multiplier"), add(paramNode("actual_base_shield_value"), multiply(paramNode("bonus_health_ratio"), attrs.sourceHpBonus))),
        "指定buff条件分支=1.3×默认护盾值；条件事件不在本轮接线。", 20),
    ],
    effects: [],
  },
  shen_q: {
    pending: [
      "强化普攻的魂刃方向、穿过敌方英雄资格、三次攻击扣次和减速应用时序未接线；这里只记录两种实际额外魔法伤害与三次算术总量。",
      "BaseFlatDamage使用已支持的CHARACTER_LEVEL断点值；完整角色等级求值仍以当前服务的角色等级输入为准，不把它错误放入技能等级数组。能量消耗保留为能量效果。",
    ],
    excluded: ["兵野专用加伤/封顶、建筑伤害、普通攻击物理伤害以及SteroidDuration=75等未接入分支排除。"],
    parameters: [
      levels("energy_cost", "能量消耗", "INTEGER", [140, 130, 120, 110, 100], "当前根mana数组表示慎Q能量消耗，按索引0至4取140/130/120/110/100；不能称为法力。", 10),
      characterLevels("actual_base_flat_damage", "角色等级基础附加伤害", "INTEGER", [10, 10, 10, 16, 16, 16, 22, 22, 22, 28, 28, 28, 34, 34, 34, 40, 40, 40], "当前BaseFlatDamage根阶梯为等级1起10，4/7/10/13/16级各增加6；使用已支持的CHARACTER_LEVEL完整1至18映射，断点值仍以当前服务角色等级读取。", 20),
      fixed("base_flat_damage_level1", "基础附加伤害等级1端点", "INTEGER", 10, "当前BaseFlatDamage根阶梯起点为10；仅保留来源端点。", 30),
      fixed("base_flat_damage_breakpoint_increment", "基础附加伤害断点增量", "INTEGER", 6, "当前BaseFlatDamage根在4/7/10/13/16级各增加6；仅保留断点增量。", 40),
      fixed("percent_root_ratio", "生命比例根倍率", "DECIMAL", 0.01, "当前BasePercentHealth与EmpPercentHealth根倍率为0.01；进入完整比例表达式。", 50),
      levels("base_percent_damage_points", "普通强化攻击生命百分数点", "DECIMAL", [2, 2.5, 3, 3.5, 4], "当前根DataValues.BasePercentDamage取技能等级1至5；原值百分数点，根倍率另乘0.01。", 60),
      fixed("base_percent_ap_ratio", "普通强化攻击法强倍率", "DECIMAL", 0.015, "当前BasePercentHealth第二段StatByCoefficient为0.015。", 70),
      levels("enhanced_percent_damage_points", "穿过英雄后的生命百分数点", "DECIMAL", [5, 5.5, 6, 6.5, 7], "当前根DataValues.EnhancedPercentDamage取技能等级1至5；根倍率另乘0.01。", 80),
      fixed("enhanced_percent_ap_ratio", "穿过英雄后的法强倍率", "DECIMAL", 0.02, "当前EmpPercentHealth第二段StatByCoefficient为0.02。", 90),
      fixed("enhanced_attack_count", "强化普攻次数", "INTEGER", 3, "当前根DataValues.NumEnhancedAttacks为3；不表示扣次事件已接通。", 100),
      fixed("enhanced_attack_window_ms", "强化普攻窗口（毫秒）", "INTEGER", 8000, "当前根DataValues.AttackBuffDuration为8秒，单位换算为毫秒；这是攻击窗口。", 110),
      fixed("enhanced_attack_speed_percent_points", "穿过英雄后攻速增加百分数点", "INTEGER", 50, "当前根DataValues.SteroidAS为50；不把SteroidDuration=75当作持续秒数。", 120),
      levels("slow_percent_points", "逃离慎方向减速百分数点", "INTEGER", [25, 30, 35, 40, 45], "当前根DataValues.SlowPercent取技能等级1至5；方向资格未接线。", 130),
      fixed("slow_duration_ms", "逃离方向减速持续（毫秒）", "INTEGER", 2000, "当前根DataValues.SlowDuration为2秒，单位换算为毫秒。", 140),
    ],
    formulas: [
      formula("normal_enhanced_attack_magic_damage", "奥义暮临普通强化普攻额外魔法伤害",
        add(paramNode("actual_base_flat_damage"), multiply(paramNode("percent_root_ratio"),
          multiply(add(paramNode("base_percent_damage_points"), multiply(paramNode("base_percent_ap_ratio"), attrs.sourceAp)), attrs.targetHpTotal))),
        "普通附加伤害=实际等级基础附加伤害+目标最大生命×0.01×(技能等级生命百分数点+0.015×来源总法强)。", 10),
      formula("enhanced_attack_magic_damage", "奥义暮临穿过英雄后每次额外魔法伤害",
        add(paramNode("actual_base_flat_damage"), multiply(paramNode("percent_root_ratio"),
          multiply(add(paramNode("enhanced_percent_damage_points"), multiply(paramNode("enhanced_percent_ap_ratio"), attrs.sourceAp)), attrs.targetHpTotal))),
        "穿过敌方英雄后的每次附加伤害=实际等级基础附加伤害+目标最大生命×0.01×(5至7百分数点+0.02×来源总法强)。", 20),
      formula("enhanced_attack_magic_damage_total", "奥义暮临三次强化普攻额外魔法伤害总量",
        multiply(paramNode("enhanced_attack_count"), add(paramNode("actual_base_flat_damage"), multiply(paramNode("percent_root_ratio"),
          multiply(add(paramNode("enhanced_percent_damage_points"), multiply(paramNode("enhanced_percent_ap_ratio"), attrs.sourceAp)), attrs.targetHpTotal)))),
        "三次强化普攻算术总量=3×穿过英雄后的每次额外魔法伤害；不包含普通攻击物理伤害。", 30),
    ],
    effects: [energyCostEffect("energy_cost")],
  },
  shen_w: {
    pending: [
      "自身防御区域保留，但区域开启时机、普攻格挡和最多等待2000毫秒的条件事件未接线；不写成1750毫秒全伤害减免。",
      "能量40使用当前属性目录已存在的energy资源效果；不改写成法力。",
    ],
    excluded: ["队友保护、伤害格挡事件与无敌效果不生成。"],
    parameters: [
      fixed("energy_cost", "能量消耗", "INTEGER", 40, "当前根mana数组表示慎W能量40；不能称为法力，资源接线待补。", 10),
      fixed("zone_duration_ms", "自身防御区域持续（毫秒）", "INTEGER", 1750, "当前根DataValues.ZoneDuration为1.75秒，单位换算为毫秒；不表示无敌。", 20),
      fixed("zone_wait_window_ms", "无可保护英雄时最多等待（毫秒）", "INTEGER", 2000, "当前根DataValues.ZoneDelay为2秒，单位换算为毫秒；只保留等待窗口。", 30),
    ],
    formulas: [],
    effects: [energyCostEffect("energy_cost")],
  },
  shen_e: {
    pending: [
      "嘲讽目标资格、冲刺碰撞未接线；能量回复使用已支持的CHARACTER_LEVEL断点值，触发时序仍未自动接线。",
      "能量150和造成伤害后的能量回复均使用当前属性目录已存在的energy资源效果，不改写成法力。",
    ],
    excluded: ["兵野嘲讽独立目标分配和冲刺过程排除；没有明确施法时间，不补0。"],
    parameters: [
      fixed("energy_cost", "能量消耗", "INTEGER", 150, "当前根mana数组表示慎E能量150；不能称为法力，资源接线待补。", 10),
      levels("base_damage", "基础物理伤害", "INTEGER", [60, 85, 110, 135, 160], "当前根DataValues.BaseDamage取技能等级1至5。", 20),
      fixed("bonus_health_ratio", "额外生命倍率", "DECIMAL", 0.11, "当前根TauntDamage的mStat12/formula2绑定BonusHPRatio=0.11；按来源额外生命属性读取。", 30),
      fixed("taunt_duration_ms", "嘲讽持续（毫秒）", "INTEGER", 1500, "当前根DataValues.CCDuration为1.5秒，单位换算为毫秒。", 40),
      fixed("energy_refund_level1", "造成伤害能量回复等级1端点", "INTEGER", 30, "当前energyrefund根阶梯起点30；仅保留端点，不替代实际等级输入。", 50),
      fixed("energy_refund_bonus_at_level4", "造成伤害能量回复四级断点增量", "INTEGER", 10, "当前energyrefund根在4级增加10；仅保留断点。", 60),
      fixed("energy_refund_bonus_at_level12", "造成伤害能量回复十二级断点增量", "INTEGER", 10, "当前energyrefund根在12级增加10；仅保留断点。", 70),
      characterLevels("actual_energy_refund_on_damage", "角色等级造成伤害能量回复", "INTEGER", [30, 30, 30, 40, 40, 40, 40, 40, 40, 40, 40, 50, 50, 50, 50, 50, 50, 50], "当前energyrefund根阶梯为等级1起30，4级和12级各增加10；使用已支持的CHARACTER_LEVEL完整1至18映射，真实触发仍待接。", 80),
    ],
    formulas: [formula("physical_damage", "奥义影缚物理伤害",
      add(paramNode("base_damage"), multiply(paramNode("bonus_health_ratio"), attrs.sourceHpBonus)),
      "TauntDamage=BaseDamage+0.11×来源额外生命；能量回复是独立待接资源行为。", 10)],
    effects: [energyCostEffect("energy_cost"), energyRefundEffect("actual_energy_refund_on_damage")],
  },
  shen_r: {
    pending: ["慎R只能选另一友方英雄，护盾和传送属于纯友方目标，本轮1V1范围跳过；保留完整来源依据，不生成参数、公式或效果。"],
    excluded: ["不因本轮有慎自身被动或Q/E而虚构一个可独自在1V1施放的R过程。"],
    parameters: [],
    formulas: [],
    effects: [],
  },
};

const levelMappings = {
  ornn_q: { base_damage: ["BaseDamage", value => value] },
  ornn_w: {
    minimum_damage_per_tick: ["MinimumDamagePerTick", value => value],
    target_max_health_ratio_per_tick: ["PercentHPPerTick", value => value],
    max_percent_health_total_percent_points: ["MaxPercentHPPerTickTooltip", value => value],
  },
  ornn_e: { base_damage: ["BaseDamage", value => value] },
  ornn_r: {
    base_damage_per_pass: ["RBaseDamage", value => value],
    slow_percent_points: ["RSlowPercentBasePreMath", value => value],
  },
  shen_q: {
    energy_cost: ["__MANA_INDEX0__", value => value],
    base_percent_damage_points: ["BasePercentDamage", value => value],
    enhanced_percent_damage_points: ["EnhancedPercentDamage", value => value],
    slow_percent_points: ["SlowPercent", value => value],
  },
  shen_e: { base_damage: ["BaseDamage", value => value] },
};
for (const [skillKey, mapping] of Object.entries(levelMappings)) {
  for (const [parameterKey, [dataName, convert]] of Object.entries(mapping)) {
    const parameterItem = definitions[skillKey].parameters.find(item => item.parameterKey === parameterKey);
    requireValue(parameterItem, "等级参数定义缺失", { skillKey, parameterKey });
    const expected = [];
    if (dataName === "__MANA_INDEX0__") {
      for (let index = 0; index < maxLevel(skillKey); index += 1) expected.push(officialCost(skillKey, index));
    } else {
      for (let rank = 1; rank <= maxLevel(skillKey); rank += 1) expected.push(convert(sourceData(skillKey, dataName, rank)));
    }
    const actual = Object.values(parameterItem.levelValues ?? {}).map(Number);
    requireValue(actual.length === expected.length && actual.every((value, index) => close(value, expected[index], 1e-5)),
      "候选等级值与冻结来源逐项不一致", { skillKey, parameterKey, actual, expected });
  }
}
const resourceMappings = [
  ["shen_q", "energy_cost", 5],
  ["shen_w", "energy_cost", 1],
  ["shen_e", "energy_cost", 1],
];
for (const [skillKey, parameterKey, count] of resourceMappings) {
  const raw = sourceSpell(skillKey).mana;
  const sourceValues = Array.isArray(raw) ? raw.slice(0, count).map(Number) : [];
  const expected = Array.from({ length: count }, (_, index) => officialCost(skillKey, index));
  requireValue(sourceValues.length === expected.length && sourceValues.every((value, index) => close(value, expected[index], 1e-6)),
    "慎技能能量数组与官方消耗索引0不一致", { skillKey, parameterKey, sourceValues, expected });
  const parameterItem = definitions[skillKey].parameters.find(item => item.parameterKey === parameterKey);
  if (parameterItem.valueMode === "FIXED") {
    requireValue(close(Number(parameterItem.fixedValue), expected[0], 1e-6), "慎技能固定能量与官方索引0不一致", {
      skillKey, parameterKey, actual: parameterItem.fixedValue, expected: expected[0],
    });
  }
}
const expandCharacterBreakpoints = (part, levelCount = 18) => {
  const breakpoints = [...(part.mBreakpoints ?? [])].sort((a, b) => Number(a.mLevel) - Number(b.mLevel));
  const values = [];
  for (let level = 1; level <= levelCount; level += 1) {
    let value = Number(part.mLevel1Value);
    for (const breakpoint of breakpoints) {
      if (level >= Number(breakpoint.mLevel)) value += Number(breakpoint.mAdditionalBonusAtThisLevel ?? 0);
    }
    values.push(value);
  }
  return values;
};
const characterLevelMappings = [
  ["shen_q", "actual_base_flat_damage", "BaseFlatDamage"],
  ["shen_e", "actual_energy_refund_on_damage", "energyrefund"],
];
for (const [skillKey, parameterKey, calculation] of characterLevelMappings) {
  const parameterItem = definitions[skillKey].parameters.find(item => item.parameterKey === parameterKey);
  const part = calculation === "energyrefund"
    ? sourceCalc(skillKey, calculation).mFormulaParts[0]
    : sourceCalc(skillKey, calculation).mFormulaParts[0];
  const expected = expandCharacterBreakpoints(part);
  const actual = Object.values(parameterItem?.levelValues ?? {}).map(Number);
  requireValue(parameterItem?.valueMode === "CHARACTER_LEVEL" && actual.length === 18 &&
    actual.every((value, index) => close(value, expected[index], 1e-6)),
    "角色等级断点值与冻结来源不一致", { skillKey, parameterKey, actual, expected });
}
requireValue(close(definitions.ornn_p.parameters.find(item => item.parameterKey === "base_stat_amp_ratio").fixedValue, sourceData("ornn_p", "BaseStatAmp", 1)), "奥恩P基础增幅来源不符");
requireValue(close(definitions.ornn_p.parameters.find(item => item.parameterKey === "additional_masterwork_stat_amp_ratio").fixedValue, sourceData("ornn_p", "AdditionalMythicStatAmp", 1)), "奥恩P杰作增幅来源不符");
requireValue(close(definitions.ornn_q.parameters.find(item => item.parameterKey === "attack_damage_ratio").fixedValue, sourcePart("ornn_q", "TotalDamage", 1).mCoefficient), "奥恩Q攻击力系数来源不符");
requireValue(close(definitions.ornn_w.parameters.find(item => item.parameterKey === "brittle_ratio_start_endpoint").fixedValue, sourceCalc("ornn_w", "BrittlePercentMaxHPCalc").mFormulaParts[0].mStartValue), "奥恩W易碎起点来源不符");
requireValue(close(definitions.ornn_w.parameters.find(item => item.parameterKey === "brittle_ratio_end_endpoint").fixedValue, sourceCalc("ornn_w", "BrittlePercentMaxHPCalc").mFormulaParts[0].mEndValue), "奥恩W易碎终点来源不符");
requireValue(close(definitions.ornn_e.parameters.find(item => item.parameterKey === "armor_ratio").fixedValue, sourceData("ornn_e", "ArmorRatio", 1)), "奥恩E护甲倍率来源不符");
requireValue(close(definitions.ornn_e.parameters.find(item => item.parameterKey === "magic_resistance_ratio").fixedValue, sourceData("ornn_e", "MRRatio", 1)), "奥恩E魔抗倍率来源不符");
requireValue(close(definitions.ornn_r.parameters.find(item => item.parameterKey === "ap_ratio").fixedValue, sourceData("ornn_r", "RRatio", 1)), "奥恩R法强倍率来源不符");
requireValue(close(definitions.shen_p.parameters.find(item => item.parameterKey === "bonus_health_ratio").fixedValue, sourcePart("shen_p", "{58a09e24}", 1).mCoefficient), "慎P额外生命倍率来源不符");
requireValue(close(definitions.shen_q.parameters.find(item => item.parameterKey === "percent_root_ratio").fixedValue, sourceCalc("shen_q", "BasePercentHealth").mMultiplier.mNumber), "慎Q普通根倍率来源不符");
requireValue(close(definitions.shen_q.parameters.find(item => item.parameterKey === "base_percent_ap_ratio").fixedValue, sourcePart("shen_q", "BasePercentHealth", 1).mCoefficient), "慎Q普通法强倍率来源不符");
requireValue(close(definitions.shen_q.parameters.find(item => item.parameterKey === "enhanced_percent_ap_ratio").fixedValue, sourcePart("shen_q", "EmpPercentHealth", 1).mCoefficient), "慎Q强化法强倍率来源不符");
requireValue(close(definitions.shen_e.parameters.find(item => item.parameterKey === "bonus_health_ratio").fixedValue, sourceData("shen_e", "BonusHPRatio", 1)), "慎E额外生命倍率来源不符");

const skills = {};
for (const skillKey of skillKeys) {
  const entry = sourceEntry(skillKey);
  const definition = definitions[skillKey];
  const reused = publicReuse.filter(item => item.skillKey === skillKey);
  const parameters = [...reused.map(item => publicBodies.get(item.skillKey + "|" + item.parameterKey)), ...definition.parameters];
  const parameterKeys = new Set(parameters.map(item => item.parameterKey));
  requireValue(parameterKeys.size === parameters.length, "参数稳定键重复", skillKey);
  skills[skillKey] = {
    skillKey,
    name: entry.summary.name,
    maxLevel: maxLevel(skillKey),
    source: { binding: entry.bound.binding, currentTexts: entry.bound.currentTexts },
    write: {
      parameters,
      formulas: definition.formulas,
      effects: definition.effects,
      processes: [],
      internalStates: [],
      triggerRules: [],
    },
    pending: definition.pending,
    excluded: definition.excluded,
  };
}

const reusedPublicParameters = publicReuse.map(item => ({
  skillKey: item.skillKey,
  parameterKey: item.parameterKey,
  reused: true,
  source: "当前99条保护快照既有详情",
}));
const candidate = {
  meta: {
    generatedAt: new Date().toISOString(),
    batch: "第二十九批奥恩慎",
    executor: "Luna",
    sourceVersions: { client: source.clientVersion, official: source.officialVersion },
    sourceInputSha256: frozenHashes.inputVersion,
    sourceBindingSha256: frozenHashes.sourceBinding,
    protectionSnapshotSha256: frozenHashes.protection,
    protectionSnapshotGETs: 99,
    apiWrites: 0,
  },
  reusedPublicParameters,
  skills,
};
const kinds = [
  { kind: "parameters", api: "parameters", id: "parameterKey" },
  { kind: "formulas", api: "formulas", id: "formulaKey" },
  { kind: "effects", api: "effects", id: "effectKey" },
  { kind: "processes", api: "processes", id: "processKey" },
  { kind: "internalStates", api: "internal-states", id: "stateKey" },
  { kind: "triggerRules", api: "trigger-rules", id: "ruleKey" },
];
const entries = [];
for (const skillKey of skillKeys) {
  for (const item of kinds) {
    for (const body of candidate.skills[skillKey].write[item.kind]) {
      entries.push({ skillKey, kind: item.kind, api: item.api, id: item.id, stableKey: body[item.id], route: "/skills/" + skillKey + "/" + item.api, body });
    }
  }
}
const reusedKeys = new Set(reusedPublicParameters.map(item => item.skillKey + "|" + item.parameterKey));
const intents = entries.filter(entry => !(entry.kind === "parameters" && reusedKeys.has(entry.skillKey + "|" + entry.stableKey))).map(entry => ({
  method: "POST", route: entry.route, skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, body: entry.body,
}));
candidate.postIntents = intents;
const candidateCounts = Object.fromEntries(kinds.map(item => [item.kind, entries.filter(entry => entry.kind === item.kind).length]));
const plan = { generatedAt: new Date().toISOString(), apiWrites: 0, count: intents.length, intents };
const sourceRange = {
  generatedAt: new Date().toISOString(),
  sourceVersions: { client: source.clientVersion, official: source.officialVersion },
  frozenHashes,
  scope: "奥恩与慎各P/Q/W/E/R；慎R因纯友方目标跳过，其余按唯一敌方英雄1V1范围记录伤害载体、自身收益、控制和资源参数。",
  skillRanges: Object.fromEntries(skillKeys.map(skillKey => [skillKey, {
    binding: skills[skillKey].source.binding,
    currentTextKeys: Object.keys(skills[skillKey].source.currentTexts),
    pending: skills[skillKey].pending,
    excluded: skills[skillKey].excluded,
    parameterCount: skills[skillKey].write.parameters.length,
    formulaCount: skills[skillKey].write.formulas.length,
    effectCount: skills[skillKey].write.effects.length,
  }])),
  notes: [
    "冷却等级统一按客户端索引1与官方数组索引0交叉核对；法力数组按官方索引0核对，慎Q/W/E能量按当前属性目录energy键保存资源变化效果。",
    "当前99条保护快照的attributes列表确认energy为启用DECIMAL属性；仓库SkillEffectResultType支持RESOURCE_CHANGE，资源操作支持CONSUME/RESTORE。",
    "奥恩P使用应用前生命/护甲/魔抗基准与10%+4%×杰作数量；数量无本轮上限，不录经济和升级事件。",
    "奥恩W保留单次MAX下限与五次总量、易碎9%至17%端点和实际比例输入；奥恩E同一敌人一次冲击范围保留，护甲映射仍为实际输入。",
    "奥恩R来回两程保留，首程减速客户端2000毫秒与官方英文3000毫秒分开保存；第三目标击飞分支排除。",
    "慎P只使用当前ShieldValue默认47至120+0.13额外生命分支，并保留指定buff的1.3倍条件端点；另一个0.07分支排除。",
    "慎Q使用0.01根倍率、普通/穿过英雄两种法强比例和三次强化普攻；能量不是法力，等级阶梯与回复曲线均无默认。",
    "未创建DAMAGE、DIRECT_HEAL或MOMENT_EVALUATION结果；未知资格、时序、曲线和资源接线记录为待补。",
  ],
};
const version = {
  generatedAt: new Date().toISOString(),
  candidateSha256: null,
  planSha256: null,
  sourceRangeSha256: null,
  sourceInputSha256: frozenHashes.inputVersion,
  sourceBindingSha256: frozenHashes.sourceBinding,
  protectionSnapshotSha256: frozenHashes.protection,
  reusedPublicParameters: 11,
  apiWrites: 0,
};
const candidateBytes = Buffer.from(JSON.stringify(candidate, null, 2) + "\n");
const planBytes = Buffer.from(JSON.stringify(plan, null, 2) + "\n");
const sourceRangeBytes = Buffer.from(JSON.stringify(sourceRange, null, 2) + "\n");
version.candidateSha256 = hash(candidateBytes);
version.planSha256 = hash(planBytes);
version.sourceRangeSha256 = hash(sourceRangeBytes);
const versionBytes = Buffer.from(JSON.stringify(version, null, 2) + "\n");
const sourceHashes = {
  generatedAt: new Date().toISOString(),
  inputFiles: frozenHashes,
  sourceFiles: inputVersion.sourceFiles,
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  sourceBindingSha256: frozenHashes.sourceBinding,
  protectionSnapshotSha256: frozenHashes.protection,
  candidateSha256: version.candidateSha256,
  planSha256: version.planSha256,
  sourceRangeSha256: version.sourceRangeSha256,
  apiWrites: 0,
};
const sourceHashesBytes = Buffer.from(JSON.stringify(sourceHashes, null, 2) + "\n");
const experience = "# 第二十九批奥恩与慎候选体验报告\n\n" +
  "本批使用冻结的客户端16.17、官方16.17.1、99条现值保护快照和11项公共参数详情生成静态候选，业务写入数为0。十个技能槽中慎R因只能选择另一友方英雄而跳过写入，其余技能保留已证数值、技能载体和自身收益。\n\n" +
  "候选保留奥恩P的自身属性增幅、Q柱与伤害、W五次下限和易碎额外伤害、E护甲/魔抗伤害、R来回两程；慎P默认护盾及指定条件1.3倍端点、Q的两种强化普攻公式和三次总量、W自身防御区域参数、E伤害和能量回复断点。\n\n" +
  "冷却和法力已分别按客户端等级索引1、官方数组索引0核对；当前保护快照确认energy属性可用，因此慎Q/W/E能量消耗和E回复按RESOURCE_CHANGE形状记录，仍不改称法力。慎Q基础附加伤害与慎E能量回复使用已支持的CHARACTER_LEVEL断点映射。施法时间冲突、奥恩E护甲基准、慎P护盾和冷却曲线、资格与时序均不填默认值。\n\n" +
  "未创建DAMAGE、直接治疗或时刻判定结果。严格独立数学脚本从候选实际表达式树求值，并从冻结源DataValues、计算树和官方数组独立计算期望；其结果只表示候选数学，尚不等同业务接口实录。\n";
const outputs = [
  ["完整候选.json", candidateBytes],
  ["请求计划.json", planBytes],
  ["来源与范围.json", sourceRangeBytes],
  ["候选版本.json", versionBytes],
  ["来源哈希汇总.json", sourceHashesBytes],
  ["体验报告.md", Buffer.from(experience)],
];
for (const [name, value] of outputs) {
  writeBytes(path.join(artifactDir, name), value);
  writeBytes(path.join(durableDir, name), value);
}
writeJson(path.join(artifactDir, "冻结文本摘要.json"), {
  generatedAt: new Date().toISOString(),
  sourceBindingSha256: frozenHashes.sourceBinding,
  skills: Object.fromEntries(skillKeys.map(skillKey => [skillKey, skills[skillKey].source.currentTexts])),
  apiWrites: 0,
});
writeBytes(path.join(durableDir, "冻结文本摘要.json"), fs.readFileSync(path.join(artifactDir, "冻结文本摘要.json")));
console.log(JSON.stringify({
  candidateSha256: version.candidateSha256,
  planSha256: version.planSha256,
  sourceRangeSha256: version.sourceRangeSha256,
  counts: candidateCounts,
  candidateEntries: entries.length,
  reusedPublicParameters: reusedPublicParameters.length,
  plannedNewDetails: intents.length,
  apiWrites: 0,
  artifactDir,
  durableDir,
}, null, 2));
