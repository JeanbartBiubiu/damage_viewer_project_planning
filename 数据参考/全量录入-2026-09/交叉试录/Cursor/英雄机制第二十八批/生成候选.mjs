import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero28-root-entry-20260909");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十八批");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
};
const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
};
const requireValue = (condition, message, detail) => {
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
  inputVersion: hash(inputVersionPath),
  sourceBinding: hash(sourceBindingPath),
  sourceNote: hash(sourceNotePath),
  protection: hash(protectionPath),
  publicReuse: hash(publicPath),
};
requireValue(inputVersion.apiWrites === 0, "输入版本已包含写入");
requireValue(inputVersion.GETs === 102, "保护GET数量不是102");
requireValue(source.clientVersion === "16.17" && source.officialVersion === "16.17.1", "来源版本不符");
requireValue(Array.isArray(publicReuse) && publicReuse.length === 14, "公共参数复用数量不是14");
requireValue(Array.isArray(protection.requests) && protection.requests.length === 102, "保护快照数量不是102");

const skillKeys = [
  "maokai_p", "maokai_q", "maokai_w", "maokai_e", "maokai_r",
  "poppy_p", "poppy_q", "poppy_w", "poppy_e", "poppy_r",
];
const heroOf = skillKey => skillKey.startsWith("maokai_") ? "Maokai" : "Poppy";
const slotOf = skillKey => skillKey.slice(-1).toUpperCase();
const boundSkill = skillKey => {
  const hero = source.heroes.find(item => item.id === heroOf(skillKey));
  const bound = hero?.skills?.find(item => item.slot === slotOf(skillKey));
  requireValue(bound, "来源绑定技能缺失", skillKey);
  return bound;
};
const sourceSummary = skillKey => {
  const hero = source.heroes.find(item => item.id === heroOf(skillKey));
  const summary = hero?.source?.skills?.find(item => item.slot === slotOf(skillKey));
  requireValue(summary, "来源技能摘要缺失", skillKey);
  return summary;
};
const maxLevel = skillKey => Number(sourceSummary(skillKey).officialMaxRank);
const sourceSpell = skillKey => boundSkill(skillKey).object.mSpell;
const sourceData = (skillKey, name, rank) => {
  const item = sourceSpell(skillKey).DataValues?.find(value => value.name === name);
  requireValue(item && Array.isArray(item.values), "来源DataValues缺失", { skillKey, name });
  const value = item.values[rank];
  requireValue(typeof value === "number" && Number.isFinite(value), "来源DataValues等级值缺失", { skillKey, name, rank });
  return value;
};
const sourceCalc = (skillKey, name) => {
  const item = sourceSpell(skillKey).mSpellCalculations?.[name];
  requireValue(item, "来源计算树缺失", { skillKey, name });
  return item;
};
const sourcePart = (skillKey, calcName, index) => {
  const value = sourceCalc(skillKey, calcName).mFormulaParts?.[index];
  requireValue(value, "来源计算树分段缺失", { skillKey, calcName, index });
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
  publicBodies.set(item.skillKey + "|" + item.parameterKey, stripIdentity(frozen.data));
}

const parameter = (parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder,
});
const fixed = (key, name, type, value, description, sortOrder) =>
  parameter(key, name, type, "FIXED", value, null, description, sortOrder);
const levels = (key, name, type, values, description, sortOrder) =>
  parameter(key, name, type, "SKILL_LEVEL", null,
    Object.fromEntries(values.map((value, index) => [String(index + 1), value])),
    description, sortOrder);
const runtime = (key, name, type, description, sortOrder) =>
  parameter(key, name, type, "RUNTIME_INPUT", null, null, description, sortOrder);
const paramNode = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const attrNode = (attributeOwner, attributeKey, attributeValueKind) => ({
  nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind,
});
const op = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const add = (left, right) => op("ADD", left, right);
const multiply = (left, right) => op("MULTIPLY", left, right);
const effectResource = parameterKey => ({
  effectKey: "mana_cost",
  name: "施放法力消耗",
  description: "仅保留当前技能的基础法力消耗；实际扣除时点与施放资格尚未接线。",
  sortOrder: 10,
  lifecycle: null,
  results: [{
    resultKey: "mana_cost",
    name: "施放法力消耗",
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
    detail: { attributeKey: "mana", operation: "CONSUME" },
  }],
});
const formula = (formulaKey, name, expression, description, sortOrder) => ({
  formulaKey, name, expression, description, sortOrder,
});
const attrs = {
  sourceHpTotal: attrNode("SOURCE", "hp", "TOTAL"),
  sourceHpBonus: attrNode("SOURCE", "hp", "BONUS"),
  sourceAp: attrNode("SOURCE", "ability_power", "TOTAL"),
  sourceBonusAd: attrNode("SOURCE", "attack_damage", "BONUS"),
};
const noRuntime = [];
const poppyQPerHitExpression = () => add(
  add(paramNode("base_damage"), multiply(paramNode("bonus_ad_ratio"), attrs.sourceBonusAd)),
  multiply(paramNode("target_max_health_ratio"), attrNode("TARGET", "hp", "TOTAL")),
);
const poppyETackleExpression = () => add(
  paramNode("base_damage"),
  multiply(paramNode("bonus_ad_ratio"), attrs.sourceBonusAd),
);
const poppyRFullExpression = () => add(
  paramNode("base_damage"),
  multiply(paramNode("bonus_ad_ratio"), attrs.sourceBonusAd),
);

function verifyLevelValues(skillKey, dataName, values) {
  requireValue(values.length === maxLevel(skillKey), "候选等级数量不符", { skillKey, dataName, values });
  values.forEach((value, index) => {
    requireValue(close(value, sourceData(skillKey, dataName, index + 1), 1e-5),
      "候选等级值与来源不符", { skillKey, dataName, rank: index + 1, value, source: sourceData(skillKey, dataName, index + 1) });
  });
}

const definitions = {
  maokai_p: {
    pending: [
      "PassiveHealingTotal的完整角色等级分段和PassiveCooldown插值均未证，两个实际输入不提供默认值。",
      "自身施放、敌方英雄命中和下一次攻击治疗的资格与时序未接线；本批不创建直接治疗结果。",
      "PassiveHealthThreshold及大型野怪/史诗野怪1.5秒分支保留来源但排除本轮。",
    ],
    excluded: ["未把根树额外伤害摘要写成参数或效果；当前详细正文和计算树只证治疗。"],
    parameters: [
      runtime("actual_passive_heal_ratio", "实际等级自身治疗比例", "DECIMAL",
        "根PassiveHealingTotal含mStat12与角色等级分段：起点0.04、每级0.002，7级后斜率0.0065；完整分段求值未证，实际输入无默认。", 10),
      runtime("passive_cooldown_ms", "被动冷却（毫秒，实际等级值外供）", "INTEGER",
        "根PassiveCooldown为30秒到20秒角色等级插值，完整等级求值未证；单位秒转毫秒，实际输入无默认。", 20),
      fixed("cooldown_reduction_on_skill_or_enemy_hit_ms", "施法或敌方英雄命中缩短被动冷却（毫秒）", "INTEGER", 4000,
        "当前正文占位PassiveCooldownReduction，根DataValues为4秒；单位秒转毫秒。只记录已证数值，不创建命中事件。", 30),
    ],
    formulas: [
      formula("healing_total", "吸元秘术自身治疗量",
        multiply(paramNode("actual_passive_heal_ratio"), attrs.sourceHpTotal),
        "PassiveHealingTotal按实际角色等级比例乘来源总生命值；比例是无默认实际输入。", 10),
    ],
    effects: [],
  },
  maokai_q: {
    pending: [
      "附近多目标、击退命中和野怪额外伤害分支不进入本轮唯一敌方英雄公式；施放资格与命中时序未接线。",
    ],
    excluded: ["NonChampMax与BonusMonsterDamage为非英雄分支；不把击退速度或几何过程写成事件。"],
    parameters: [
      fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", 375,
        "根spellCastTime为0.375秒，单位秒转毫秒；不表示伤害命中时点。", 10),
      levels("base_damage", "基础魔法伤害", "INTEGER", [75, 120, 165, 210, 255],
        "当前根DataValues.BaseDamage取技能等级1至5。", 20),
      fixed("ap_ratio", "法强倍率", "DECIMAL", 0.5,
        "当前根DataValues.APRatio取技能等级1至5均为0.5；计算树TotalDamage第二段同名取值。", 30),
      levels("target_max_health_ratio", "目标最大生命伤害比例", "DECIMAL", [0.02, 0.025, 0.03, 0.035, 0.04],
        "当前正文消费BasePercentHealth*100；根值为2%至4%的比例，录入为0.02至0.04后直接乘目标总生命。", 40),
      fixed("slow_ratio", "减速比例", "DECIMAL", 0.99,
        "当前根DataValues.SlowAmount取索引1至5均为0.99；正文描述短暂减速，资格和应用时点未接线。", 50),
      fixed("slow_duration_ms", "减速持续（毫秒）", "INTEGER", 250,
        "当前根DataValues.SlowDuration为0.25秒，单位秒转毫秒。", 60),
      fixed("knockback_distance", "近身击退距离", "INTEGER", 400,
        "当前根DataValues.KnockbackDistance为400；只记录明确距离，不创建击退过程。", 70),
    ],
    formulas: [
      formula("magic_damage", "荆棘重击对英雄魔法伤害",
        add(add(paramNode("base_damage"), multiply(paramNode("ap_ratio"), attrs.sourceAp)),
          multiply(paramNode("target_max_health_ratio"), attrNode("TARGET", "hp", "TOTAL"))),
        "TotalDamage加上正文明确的BasePercentHealth×目标最大生命值；比例按0.02至0.04录入，不遗漏第二项。", 10),
    ],
    effects: [effectResource("mana_cost")],
  },
  maokai_w: {
    pending: [
      "根须突进期间不可选取、抵达后禁锢和施放资格尚未接线；保留明确端点，不把持续过程当作普通效果。",
    ],
    excluded: ["DashAcceleration无值；突进完成时点未知，不伪造过程或事件。"],
    parameters: [
      fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", 250,
        "当前根spellCastTime为0.25秒，单位秒转毫秒；不表示禁锢或伤害命中时点。", 10),
      levels("base_damage", "基础魔法伤害", "INTEGER", [60, 85, 110, 135, 160],
        "当前根DataValues.BaseDamage取技能等级1至5。", 20),
      fixed("ap_ratio", "法强倍率", "DECIMAL", 0.4,
        "当前根TotalDamage第二段StatByCoefficient为0.4。", 30),
      levels("root_duration_ms", "禁锢持续（毫秒）", "INTEGER", [1000, 1100, 1200, 1300, 1400],
        "当前根DataValues.RootDuration为1至1.4秒，单位秒转毫秒；不表示突进过程持续。", 40),
      fixed("dash_speed", "根须突进速度", "INTEGER", 1300,
        "当前根DataValues.DashSpeed为1300；突进阶段和抵达时序未接线。", 50),
    ],
    formulas: [
      formula("magic_damage", "扭曲突刺魔法伤害",
        add(paramNode("base_damage"), multiply(paramNode("ap_ratio"), attrs.sourceAp)),
        "TotalDamage=BaseDamage+0.4×来源总法强。", 10),
    ],
    effects: [effectResource("mana_cost")],
  },
  maokai_e: {
    pending: [
      "树苗自主戒备、追踪、爆炸、草丛升级及其持续与伤害按独立召唤/陷阱边界排除；额外缩短P冷却需后续外供事件接入。",
    ],
    excluded: [
      "不创建树苗实体、树苗伤害、持续时间、追踪或草丛强化效果；这些是独立自主行为，不因本参数而恢复。",
    ],
    parameters: [
      fixed("passive_cooldown_reduction_on_hero_hit_ms", "命中英雄缩短茂凯被动冷却（毫秒）", "INTEGER", 4000,
        "当前树苗正文明确命中敌方英雄或史诗野怪时额外缩短吸元秘术4秒；本轮仅保留英雄相关明确数值，树苗命中事件与外供方式待接。", 10),
    ],
    formulas: [],
    effects: [],
  },
  maokai_r: {
    pending: [
      "禁锢持续随行进距离变化，中间曲线未知；命中英雄后移动速度持续衰减，资格和衰减过程未接线。",
    ],
    excluded: [
      "RootDuration=0.6无当前正文消费者；不以其替换0.75至2.25端点，不创建普通固定移速效果。",
    ],
    parameters: [
      levels("base_damage", "基础魔法伤害", "INTEGER", [150, 225, 300],
        "当前根DataValues.BaseDamage取技能等级1至3。", 10),
      fixed("ap_ratio", "法强倍率", "DECIMAL", 0.75,
        "当前根TotalDamage第二段StatByCoefficient为0.75。", 20),
      levels("minimum_root_duration_ms", "最低禁锢持续（毫秒）", "INTEGER", [750, 750, 750],
        "当前正文消费MinRootDuration，根值0.75秒；单位秒转毫秒，中间随距离变化未接线。", 30),
      levels("maximum_root_duration_ms", "最高禁锢持续（毫秒）", "INTEGER", [2250, 2250, 2250],
        "当前正文消费MaxRootDuration，根值2.25秒；单位秒转毫秒，中间随距离变化未接线。", 40),
      levels("move_haste_percent_points", "命中英雄后移动速度百分数点", "INTEGER", [40, 50, 60],
        "当前正文消费MoveHaste*100，根值0.4至0.6，录入为40至60百分数点；衰减过程未接线。", 50),
      fixed("haste_duration_ms", "移动速度衰减持续（毫秒）", "INTEGER", 2000,
        "当前正文消费HasteDuration，根值2秒；单位秒转毫秒。", 60),
    ],
    formulas: [
      formula("magic_damage", "自然之握魔法伤害",
        add(paramNode("base_damage"), multiply(paramNode("ap_ratio"), attrs.sourceAp)),
        "TotalDamage=BaseDamage+0.75×来源总法强；荆棘墙作为技能伤害载体保留。", 10),
    ],
    effects: [effectResource("mana_cost")],
  },
  poppy_p: {
    pending: [
      "ActualCooldown和TotalDamage是角色等级插值，ShieldValue比例也是角色等级插值，完整求值未证，实际输入无默认。",
      "圆盾投掷、落地、拾取、敌人踩碎和击杀返回资格及时序未接线；本批不创建召唤物或直接伤害/护盾结果。",
    ],
    excluded: ["不把圆盾当独立自主召唤物；只保留自身护盾金额公式和明确窗口参数。"],
    parameters: [
      fixed("bonus_attack_range", "圆盾攻击距离增加", "INTEGER", 350,
        "当前根DataValues.BonusRange为350。", 10),
      runtime("actual_cooldown_ms", "被动冷却（毫秒，实际角色等级值外供）", "INTEGER",
        "根ActualCooldown为16秒并含7/13/19级断点，完整角色等级求值未证；单位秒转毫秒，实际输入无默认。", 20),
      runtime("actual_passive_magic_damage", "圆盾实际魔法伤害（实际角色等级值外供）", "DECIMAL",
        "根TotalDamage为20至180角色等级插值，完整求值未证；实际输入无默认，不把端点展平成曲线。", 30),
      runtime("actual_shield_ratio_by_character_level", "实际角色等级护盾生命比例", "DECIMAL",
        "根ShieldValue为mStat12乘角色等级插值0.11至0.20，完整求值未证；实际输入无默认。", 40),
      fixed("shield_pickup_window_ms", "圆盾落地后拾取窗口（毫秒）", "INTEGER", 4000,
        "当前根DataValues.ShieldPickUpTime为4秒，单位秒转毫秒。", 50),
      fixed("shield_duration_ms", "拾取后护盾持续（毫秒）", "INTEGER", 3000,
        "当前根DataValues.ShieldDuration为3秒，单位秒转毫秒。", 60),
    ],
    formulas: [
      formula("shield_value", "钢铁大使自身护盾值",
        multiply(paramNode("actual_shield_ratio_by_character_level"), attrs.sourceHpTotal),
        "ShieldValue=实际角色等级护盾比例×来源总生命值；比例无默认。", 10),
    ],
    effects: [],
  },
  poppy_q: {
    pending: [
      "两次伤害、同一敌人叠加和区域减速的命中与应用时序未接线；本轮只表达唯一敌人两次同额伤害和端点。",
      "小兵野怪百分比伤害上限及其他目标分支排除。",
    ],
    excluded: ["MaxHealthDamageToNonHeroes为非英雄上限；不按AoE名称扩展到其他目标。"],
    parameters: [
      fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", 333,
        "当前根spellCastTime为0.3324999809秒，按已记录的0.3325秒就近归一为333毫秒；不把显示精度当通用舍入规则。", 10),
      levels("base_damage", "每次基础物理伤害", "INTEGER", [30, 55, 80, 105, 130],
        "当前根DataValues.BaseDamageValue取技能等级1至5；两次正文均消费同一BaseDamage。", 20),
      fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", 0.75,
        "当前根BaseDamage计算树StatByCoefficient为0.75，mStat2/mStatFormula2指向来源额外攻击力。", 30),
      levels("target_max_health_ratio", "目标最大生命伤害比例", "DECIMAL", [0.07, 0.075, 0.08, 0.085, 0.09],
        "当前根DataValues.HealthDamagePercent为7%至9%，按比例0.07至0.09直接乘目标总生命；小兵野怪上限排除。", 40),
      fixed("hit_count_same_target", "同一敌人伤害次数", "INTEGER", 2,
        "当前正文明确第一次命中及延迟后再次对同一敌人造成同额伤害；仅用于同一敌人总量公式。", 50),
      fixed("delay_between_hits_ms", "两次伤害间隔（毫秒）", "INTEGER", 1000,
        "当前根DataValues.DelayBetweenTwoHits为1秒，单位秒转毫秒。", 60),
      levels("base_slow_ratio", "基础减速比例", "DECIMAL", [0.2, 0.23, 0.26, 0.29, 0.32],
        "当前根MoveSpeedMod的基础值为0.20至0.32；这里按比例记录，应用持续和范围阶段未接线。", 70),
      fixed("slow_bonus_health_coefficient", "额外生命减速系数", "DECIMAL", 0.00008,
        "当前根MoveSpeedMod第二段为0.00008×来源额外生命，mStat12/mStatFormula2；来源字段名称不替代属性口径。", 80),
      fixed("slow_duration_ms", "区域减速持续（毫秒）", "INTEGER", 500,
        "当前根DataValues.SlowDuration为0.5秒，单位秒转毫秒；不扩为两次伤害间隔全程。", 90),
    ],
    formulas: [
      formula("physical_damage_per_hit", "圣锤猛击单次物理伤害",
        add(add(paramNode("base_damage"), multiply(paramNode("bonus_ad_ratio"), attrs.sourceBonusAd)),
          multiply(paramNode("target_max_health_ratio"), attrNode("TARGET", "hp", "TOTAL"))),
        "每一次正文伤害=基础+0.75×来源额外攻击力+目标最大生命比例×目标总生命。", 10),
      formula("physical_damage_same_target_total", "圣锤猛击同一敌人两次总物理伤害",
        multiply(paramNode("hit_count_same_target"), poppyQPerHitExpression()),
        "同一敌人两次命中总量=2×单次伤害；不表示其他目标分发或命中事件已接通。", 20),
      formula("slow_ratio", "圣锤猛击减速比例",
        add(paramNode("base_slow_ratio"),
          multiply(paramNode("slow_bonus_health_coefficient"), attrs.sourceHpBonus)),
        "MoveSpeedMod=基础减速比例+0.00008×来源额外生命；减速应用范围和时长独立记录。", 30),
    ],
    effects: [effectResource("mana_cost")],
  },
  poppy_w: {
    pending: [
      "双抗基准取应用前实际值；mStat1/mStat6的完整属性分派、自增反馈和低生命条件事件未证。",
      "敌方突进资格、打断、同目标次数及减速/缚地应用时序未接线；本轮保留明确伤害和端点。",
    ],
    excluded: ["KnockupDuration虽有来源字段但当前正文未消费；不把它混入缚地或主动领域效果。"],
    parameters: [
      fixed("passive_resist_ratio", "被动双抗比例", "DECIMAL", 0.16,
        "当前根DataValues.PassiveResistPercent为0.16；BonusArmor和BonusMR分别使用mStat1与mStat6，不能凭字段名改成额外双抗。", 10),
      fixed("passive_low_health_threshold_ratio", "被动翻倍生命阈值", "DECIMAL", 0.4,
        "当前正文消费PassiveEmpoweredHealthPercent*100，根值0.4；条件判断事件未接线。", 20),
      fixed("passive_low_health_multiplier", "低生命被动双抗倍率", "INTEGER", 2,
        "当前正文写明生命低于40%时双抗加成翻倍；保留端点倍率，不代表条件事件已接通。", 30),
      runtime("actual_source_armor_before_passive", "被动应用前来源护甲", "DECIMAL",
        "mStat1的应用前正确护甲基准由实际输入提供；不以BonusArmor字段名猜额外护甲，实际输入无默认。", 40),
      runtime("actual_source_magic_resistance_before_passive", "被动应用前来源魔抗", "DECIMAL",
        "mStat6的应用前正确魔抗基准由实际输入提供；不以BonusMagicResistance字段名猜额外魔抗，实际输入无默认。", 50),
      fixed("active_haste_percent_points", "主动移动速度百分数点", "INTEGER", 40,
        "当前根DataValues.Haste为40，正文以百分号显示；保留百分数点。", 60),
      fixed("active_duration_ms", "主动领域持续（毫秒）", "INTEGER", 2000,
        "当前根DataValues.Duration为2秒，单位秒转毫秒。", 70),
      fixed("grounding_duration_ms", "缚地持续（毫秒）", "INTEGER", 2000,
        "当前根DataValues.GroundingDuration为2秒，单位秒转毫秒。", 80),
      fixed("slow_percent_points", "敌人减速百分数点", "INTEGER", 25,
        "原始SlowAmount为-0.25，当前正文消费SlowAmount*-100；录入正25，避免对负原值再次取负。", 90),
      levels("base_interrupt_damage", "打断突进基础魔法伤害", "INTEGER", [70, 110, 150, 190, 230],
        "当前根DataValues.DamageValue取技能等级1至5。", 100),
      fixed("ap_ratio", "打断突进法强倍率", "DECIMAL", 0.7,
        "当前根InterruptDamage第二段StatByCoefficient为0.7。", 110),
    ],
    formulas: [
      formula("passive_bonus_armor", "被动额外护甲",
        multiply(paramNode("passive_resist_ratio"), paramNode("actual_source_armor_before_passive")),
        "BonusArmor的mStat1窄口径表达为0.16×应用前来源护甲；基准实际输入无默认。", 10),
      formula("passive_bonus_armor_low_health", "低生命被动额外护甲",
        multiply(multiply(paramNode("passive_resist_ratio"), paramNode("passive_low_health_multiplier")),
          paramNode("actual_source_armor_before_passive")),
        "生命低于40%时双抗加成端点=0.16×2×应用前来源护甲；条件事件未接线。", 20),
      formula("passive_bonus_magic_resistance", "被动额外魔抗",
        multiply(paramNode("passive_resist_ratio"), paramNode("actual_source_magic_resistance_before_passive")),
        "BonusMR的mStat6窄口径表达为0.16×应用前来源魔抗；基准实际输入无默认。", 30),
      formula("passive_bonus_magic_resistance_low_health", "低生命被动额外魔抗",
        multiply(multiply(paramNode("passive_resist_ratio"), paramNode("passive_low_health_multiplier")),
          paramNode("actual_source_magic_resistance_before_passive")),
        "生命低于40%时双抗加成端点=0.16×2×应用前来源魔抗；条件事件未接线。", 40),
      formula("interrupt_magic_damage", "打断突进魔法伤害",
        add(paramNode("base_interrupt_damage"), multiply(paramNode("ap_ratio"), attrs.sourceAp)),
        "InterruptDamage=DamageValue+0.7×来源总法强；敌方突进资格和打断事件未接线。", 50),
    ],
    effects: [effectResource("mana_cost")],
  },
  poppy_e: {
    pending: [
      "撞墙资格、推进过程和晕眩应用未接线；同一目标撞墙时第二次伤害沿当前正文保留。",
    ],
    excluded: ["不使用LevelUp里的WallDamage替换正文第二次消费的TackleDamage；不创建第二敌人分支。"],
    parameters: [
      levels("base_damage", "英勇冲锋基础物理伤害", "INTEGER", [40, 60, 80, 100, 120],
        "当前根DataValues.BaseDamageValue取技能等级1至5。", 10),
      fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", 0.6,
        "当前根TackleDamage第二段mCoefficient为0.6，mStat2/mStatFormula2指向来源额外攻击力。", 20),
      levels("stun_duration_ms", "撞墙晕眩持续（毫秒）", "INTEGER", [1600, 1700, 1800, 1900, 2000],
        "当前根DataValues.StunDuration为1.6至2秒，单位秒转毫秒。", 30),
      fixed("max_pushback_distance", "最大推进距离", "INTEGER", 400,
        "当前根DataValues.MaxEnemyPushbackDistance为400。", 40),
      fixed("wall_hit_count", "撞墙同一目标伤害次数", "INTEGER", 2,
        "当前正文明确首次TackleDamage及撞墙后额外一次同额TackleDamage；不表示第二名敌人。", 50),
    ],
    formulas: [
      formula("tackle_physical_damage", "英勇冲锋单次物理伤害",
        add(paramNode("base_damage"), multiply(paramNode("bonus_ad_ratio"), attrs.sourceBonusAd)),
        "TackleDamage=BaseDamageValue+0.6×来源额外攻击力。", 10),
      formula("wall_collision_total_physical_damage", "英勇冲锋撞墙两次总物理伤害",
        multiply(paramNode("wall_hit_count"), poppyETackleExpression()),
        "撞墙同一目标总量=两次TackleDamage；只记录当前正文消费关系。", 20),
    ],
    effects: [effectResource("mana_cost")],
  },
  poppy_r: {
    pending: [
      "蓄力时长到击退距离和冲击波距离的中间曲线、释放时序、飞行不可选取及目标资格未接线；荆棘墙/冲击波按技能载体保留。",
    ],
    excluded: [
      "CancelCDRefund、充能到最大距离1秒、蓄力击飞2秒等当前正文未消费字段不录入；不把附近额外目标分发加入唯一敌人公式。",
    ],
    parameters: [
      levels("base_damage", "持卫的裁决完整基础物理伤害", "INTEGER", [200, 300, 400],
        "当前根DataValues.BaseDamage取技能等级1至3。", 10),
      fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", 0.9,
        "当前根Damage第二段mCoefficient为0.9，mStat2/mStatFormula2指向来源额外攻击力。", 20),
      fixed("channel_max_duration_ms", "最大蓄力持续（毫秒）", "INTEGER", 4000,
        "当前正文消费ChannelMaxDuration为4秒，单位秒转毫秒。", 30),
      fixed("self_slow_percent_points", "蓄力自身减速百分数点", "INTEGER", 15,
        "当前正文消费SelfSlow为15%；保留百分数点。", 40),
      fixed("snap_cast_damage_ratio", "未蓄力伤害比例", "DECIMAL", 0.5,
        "当前正文消费HalfDamage，根HalfDamage为Damage乘SnapCastDamageRatio=0.5。", 50),
      fixed("snap_knockup_duration_ms", "未蓄力击飞持续（毫秒）", "INTEGER", 1000,
        "当前正文消费KnockupDurationSnap为1秒，单位秒转毫秒。", 60),
      fixed("cast_time_ms", "开始施法时间（毫秒）", "INTEGER", 0,
        "当前根spellCastTime为0；只记录开始施法字段，不等同释放完成或命中时点。", 70),
    ],
    formulas: [
      formula("full_physical_damage", "持卫的裁决蓄力物理伤害",
        add(paramNode("base_damage"), multiply(paramNode("bonus_ad_ratio"), attrs.sourceBonusAd)),
        "Damage=BaseDamage+0.9×来源额外攻击力；蓄力距离变化未接线。", 10),
      formula("snap_physical_damage", "持卫的裁决未蓄力物理伤害",
        multiply(paramNode("snap_cast_damage_ratio"), poppyRFullExpression()),
        "HalfDamage=Damage×0.5；点按控制和释放时序未接线。", 20),
    ],
    effects: [effectResource("mana_cost")],
  },
};

for (const skillKey of skillKeys) {
  const definition = definitions[skillKey];
  const summary = sourceSummary(skillKey);
  for (const [index, parameterItem] of definition.parameters.entries()) {
    if (parameterItem.valueMode === "SKILL_LEVEL") {
      const values = Object.values(parameterItem.levelValues);
      const mapping = {
        maokai_q: { base_damage: "BaseDamage", target_max_health_ratio: "BasePercentHealth" },
        maokai_w: { base_damage: "BaseDamage", root_duration_ms: "RootDuration" },
        maokai_r: { base_damage: "BaseDamage", minimum_root_duration_ms: "MinRootDuration", maximum_root_duration_ms: "MaxRootDuration", move_haste_percent_points: "MoveHaste" },
        poppy_q: { base_damage: "BaseDamageValue", target_max_health_ratio: "HealthDamagePercent", base_slow_ratio: "BaseMoveSpeedMod" },
        poppy_w: { base_interrupt_damage: "DamageValue" },
        poppy_e: { base_damage: "BaseDamageValue", stun_duration_ms: "StunDuration" },
        poppy_r: { base_damage: "BaseDamage" },
      }[skillKey]?.[parameterItem.parameterKey];
      if (mapping) {
        const sourceValues = [];
        for (let rank = 1; rank <= maxLevel(skillKey); rank += 1) {
          const raw = sourceData(skillKey, mapping, rank);
          if (parameterItem.parameterKey === "target_max_health_ratio") {
            sourceValues.push(skillKey === "poppy_q" ? raw / 100 : raw);
          }
          else if (parameterItem.parameterKey === "base_slow_ratio") sourceValues.push(raw);
          else if (parameterItem.parameterKey === "move_haste_percent_points") sourceValues.push(raw * 100);
          else if (parameterItem.parameterKey === "minimum_root_duration_ms" || parameterItem.parameterKey === "maximum_root_duration_ms" || parameterItem.parameterKey === "root_duration_ms" || parameterItem.parameterKey === "stun_duration_ms") sourceValues.push(raw * 1000);
          else sourceValues.push(raw);
        }
        requireValue(values.every((value, itemIndex) => close(value, sourceValues[itemIndex], 1e-5)),
          "来源等级值逐项核对失败", { skillKey, parameter: parameterItem.parameterKey, values, sourceValues });
      }
    }
  }
  requireValue(boundSkill(skillKey).skillKey === skillKey && summary.slot === slotOf(skillKey),
    "来源绑定技能键或槽位不一致", { skillKey, slot: summary.slot });
}

const skills = {};
for (const skillKey of skillKeys) {
  const summary = sourceSummary(skillKey);
  const definition = definitions[skillKey];
  const reused = publicReuse.filter(item => item.skillKey === skillKey);
  const allParameters = [
    ...reused.map(item => publicBodies.get(item.skillKey + "|" + item.parameterKey)),
    ...definition.parameters,
  ];
  const parameterKeys = new Set(allParameters.map(item => item.parameterKey));
  requireValue(parameterKeys.size === allParameters.length, "参数稳定键重复", skillKey);
  skills[skillKey] = {
    skillKey,
    name: summary.name,
    maxLevel: maxLevel(skillKey),
    source: {
      binding: boundSkill(skillKey).binding,
      currentTexts: boundSkill(skillKey).currentTexts,
    },
    write: {
      parameters: allParameters,
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
  source: "当前保护快照既有详情",
}));
const candidate = {
  meta: {
    generatedAt: new Date().toISOString(),
    batch: "第二十八批茂凯波比",
    executor: "Luna",
    sourceVersions: { client: source.clientVersion, official: source.officialVersion },
    sourceInputSha256: frozenHashes.inputVersion,
    sourceBindingSha256: frozenHashes.sourceBinding,
    protectionSnapshotSha256: frozenHashes.protection,
    protectionSnapshotGETs: 102,
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
      entries.push({
        skillKey,
        kind: item.kind,
        api: item.api,
        id: item.id,
        stableKey: body[item.id],
        route: "/skills/" + skillKey + "/" + item.api,
        body,
      });
    }
  }
}
const reusedKeys = new Set(reusedPublicParameters.map(item => item.skillKey + "|" + item.parameterKey));
const intents = entries.filter(entry => !(
  entry.kind === "parameters" && reusedKeys.has(entry.skillKey + "|" + entry.stableKey)
)).map(entry => ({
  method: "POST",
  route: entry.route,
  skillKey: entry.skillKey,
  kind: entry.kind,
  stableKey: entry.stableKey,
  body: entry.body,
}));
candidate.postIntents = intents;
const candidateCounts = Object.fromEntries(kinds.map(item => [
  item.kind,
  entries.filter(entry => entry.kind === item.kind).length,
]));
const plan = {
  generatedAt: new Date().toISOString(),
  apiWrites: 0,
  count: intents.length,
  intents,
};
const inputSummary = {
  generatedAt: new Date().toISOString(),
  sourceVersions: { client: source.clientVersion, official: source.officialVersion },
  frozenHashes,
  candidateCounts,
  candidateEntries: entries.length,
  reusedPublicParameters: reusedPublicParameters.length,
  plannedNewDetails: intents.length,
  protectedGETs: 102,
  apiWrites: 0,
  skills: skillKeys,
  note: "候选只写技能组成意图；主体、分类、关系、图片、保护快照和未证树苗/事件均不生成写入。",
};
const sourceRange = {
  generatedAt: new Date().toISOString(),
  sourceVersions: { client: source.clientVersion, official: source.officialVersion },
  frozenHashes,
  scope: "茂凯与波比各P/Q/W/E/R，唯一敌方英雄伤害口径；技能伤害载体保留，独立自主树苗/陷阱与其他目标分支排除。",
  skillRanges: Object.fromEntries(skillKeys.map(skillKey => [skillKey, {
    binding: candidate.skills[skillKey].source.binding,
    currentTextKeys: Object.keys(candidate.skills[skillKey].source.currentTexts),
    pending: candidate.skills[skillKey].pending,
    excluded: candidate.skills[skillKey].excluded,
    parameterCount: candidate.skills[skillKey].write.parameters.length,
    formulaCount: candidate.skills[skillKey].write.formulas.length,
    effectCount: candidate.skills[skillKey].write.effects.length,
  }])),
  notes: [
    "茂凯E只保留当前正文明确的命中英雄额外4秒P冷却收益参数；树苗实体、追踪、爆炸、草丛升级和独立过程排除。",
    "茂凯R荆棘墙作为技能伤害载体保留；禁锢中间曲线和命中英雄后的移速衰减不猜。",
    "波比Q两次同一敌人伤害分别表达并提供同一敌人总量；目标最大生命比例和来源额外攻击力不省略。",
    "波比W双抗使用应用前护甲/魔抗实际输入，低于40%生命翻倍只表达端点；不凭BonusArmor名称选择属性。",
    "波比E和R保留当前正文消费的TackleDamage、HalfDamage；WallDamage等未消费或不同分支字段不替代正文。",
    "所有未知等级曲线、资格、时序与中间曲线使用无默认实际输入或列为待接，不创建DAMAGE、DIRECT_HEAL或MOMENT_EVALUATION结果。",
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
  reusedPublicParameters: 14,
  apiWrites: 0,
};
const candidateBytes = Buffer.from(JSON.stringify(candidate, null, 2) + "\n");
const planBytes = Buffer.from(JSON.stringify(plan, null, 2) + "\n");
const sourceRangeBytes = Buffer.from(JSON.stringify(sourceRange, null, 2) + "\n");
version.candidateSha256 = crypto.createHash("sha256").update(candidateBytes).digest("hex");
version.planSha256 = crypto.createHash("sha256").update(planBytes).digest("hex");
version.sourceRangeSha256 = crypto.createHash("sha256").update(sourceRangeBytes).digest("hex");
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
const experience = "# 第二十八批茂凯与波比候选体验报告\n\n" +
  "本批使用冻结的客户端16.17、官方16.17.1和102条现值保护快照生成静态候选，业务写入数为0。候选包含茂凯、波比各P/Q/W/E/R十个技能槽；公共参数14项从保护快照原值复用，新增参数、公式和法力消耗效果只作为计划意图。\n\n" +
  "本轮保留茂凯Q目标最大生命补伤、茂凯R荆棘墙技能伤害载体、波比Q同一敌人两次伤害、波比W低生命双抗翻倍端点、波比E撞墙第二次TackleDamage和波比R点按HalfDamage。茂凯E的树苗自主行为排除，但当前正文明确的命中英雄额外缩短P冷却4秒作为待接跨技能收益参数保留。\n\n" +
  "未知的角色等级分段、双抗基准、资格、命中与施放时序、蓄力或行进中间曲线均不填默认值。没有创建树苗或圆盾等独立自主召唤物，也没有创建DAMAGE、DIRECT_HEAL或MOMENT_EVALUATION结果；法力消耗沿已保存的资源变化形状记录。\n\n" +
  "候选范围与排除项见《来源与范围.json》。真正解析表达式的独立核算脚本从候选树求值，并以冻结客户端DataValues和计算树独立计算期望；其结果只表示候选数学，尚不等同业务接口实录。\n";

fs.mkdirSync(artifactDir, { recursive: true });
fs.mkdirSync(durableDir, { recursive: true });
const outputs = [
  ["完整候选.json", candidateBytes],
  ["请求计划.json", planBytes],
  ["来源与范围.json", sourceRangeBytes],
  ["候选版本.json", versionBytes],
  ["来源哈希汇总.json", sourceHashesBytes],
  ["体验报告.md", Buffer.from(experience)],
];
for (const [name, bytes] of outputs) {
  fs.writeFileSync(path.join(artifactDir, name), bytes);
  fs.writeFileSync(path.join(durableDir, name), bytes);
}
writeJson(path.join(artifactDir, "冻结文本摘要.json"), {
  generatedAt: new Date().toISOString(),
  sourceBindingSha256: frozenHashes.sourceBinding,
  skills: Object.fromEntries(skillKeys.map(skillKey => [skillKey, candidate.skills[skillKey].source.currentTexts])),
  apiWrites: 0,
});
writeJson(path.join(durableDir, "冻结文本摘要.json"), readJson(path.join(artifactDir, "冻结文本摘要.json")));

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
