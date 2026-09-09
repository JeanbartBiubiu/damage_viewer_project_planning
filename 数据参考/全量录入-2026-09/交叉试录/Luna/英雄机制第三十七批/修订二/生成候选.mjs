import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = fs.existsSync(path.join(ROOT, "输入包")) ? path.join(ROOT, "输入包") : path.join(ROOT, "..", "输入包");
const BATCH = "英雄机制第三十七批";
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const NODE_SOURCE = "当前绑定树与固定版本来源";
const readInput = (file) => JSON.parse(fs.readFileSync(path.join(INPUT, file), "utf8"));
const writeJson = (file, value) => fs.writeFileSync(path.join(ROOT, file), JSON.stringify(value, null, 2) + "\n", "utf8");
const writeText = (file, value) => fs.writeFileSync(path.join(ROOT, file), value, "utf8");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fileSha = (file) => sha(fs.readFileSync(path.join(INPUT, file)));
const clean = (value) => typeof value === "number" ? Number(value.toFixed(8)) : value;
const ms = (seconds) => {
  const value = Math.round(Number(seconds) * 1000);
  if (!Number.isInteger(value)) throw new Error("毫秒换算不是整数: " + seconds);
  return value;
};

const inputVersion = readInput("输入版本.json");
const binding = readInput("来源绑定与当前文本.json");
const snapshot = readInput("参考资料/当前20槽保护快照.json");
const reuse = readInput("参考资料/公共参数复用清单.json");
const sourceVersion = {
  clientVersion: inputVersion.clientVersion,
  officialVersion: inputVersion.officialVersion,
  build: "16.17.8104348+branch.releases-16-17.content.release",
};
const order = [
  "akshan_p", "akshan_q", "akshan_w", "akshan_e", "akshan_r",
  "ambessa_p", "ambessa_q", "ambessa_w", "ambessa_e", "ambessa_r",
  "aurora_p", "aurora_q", "aurora_w", "aurora_e", "aurora_r",
  "briar_p", "briar_q", "briar_w", "briar_e", "briar_r",
];
const heroIds = {
  akshan: "Akshan",
  ambessa: "Ambessa",
  aurora: "Aurora",
  briar: "Briar",
};
const heroesById = Object.fromEntries(binding.heroes.map((hero) => [hero.id, hero]));
const slotOf = (skillKey) => skillKey.split("_")[1].toUpperCase();
const heroOf = (skillKey) => heroIds[skillKey.split("_")[0]];
const bound = (skillKey) => {
  const hero = heroesById[heroOf(skillKey)];
  const skill = hero?.skills.find((item) => item.skillKey === skillKey || item.slot === slotOf(skillKey));
  if (!hero || !skill) throw new Error("缺少来源绑定 " + skillKey);
  return { hero, skill, raw: skill.object.mSpell };
};
const data = (skillKey, name) => {
  const values = bound(skillKey).raw.DataValues?.find((item) => item.name === name)?.values;
  if (!values) throw new Error("缺少DataValues " + skillKey + "/" + name);
  return values;
};
const at = (skillKey, name, index = 1) => clean(data(skillKey, name)[index]);
const levels = (skillKey, name, maxLevel, transform = clean) => data(skillKey, name).slice(1, maxLevel + 1).map(transform);
const calc = (skillKey, name) => bound(skillKey).raw.mSpellCalculations?.[name] || null;
const calcPart = (skillKey, name, index = 0) => {
  const part = calc(skillKey, name)?.mFormulaParts?.[index];
  if (!part) throw new Error("缺少计算树节点 " + skillKey + "/" + name + "/" + index);
  return part;
};
const coefficient = (skillKey, name, index = null) => {
  const parts = calc(skillKey, name)?.mFormulaParts || [];
  const part = index === null
    ? parts.find((item) => typeof item?.mCoefficient === "number")
    : parts[index];
  if (!part || typeof part.mCoefficient !== "number") throw new Error("缺少计算树系数 " + skillKey + "/" + name);
  return clean(part.mCoefficient);
};
const sourceFile = (hero, kind) => {
  const name = hero.id + ".json";
  return kind === "client" ? "参考资料/客户端原文/" + name + ".gz" : "参考资料/官方" + (kind === "zh" ? "中文" : "英文") + "/" + name;
};
const officialEvidence = (heroId, slot) => {
  const file = readInput("参考资料/官方英文/" + heroId + ".json");
  const hero = file.data?.[heroId] || file[heroId] || file;
  if (slot === "P") {
    return {
      path: "data." + heroId + ".passive",
      name: hero.passive?.name || null,
      description: hero.passive?.description || null,
      tooltip: hero.passive?.tooltip || null,
      relevantEnemyTips: hero.enemytips || [],
    };
  }
  const index = { Q: 0, W: 1, E: 2, R: 3 }[slot];
  const spell = hero.spells?.[index];
  return {
    path: "data." + heroId + ".spells[" + index + "]",
    name: spell?.name || null,
    description: spell?.description || null,
    tooltip: spell?.tooltip || null,
  };
};
const sourceFor = (skillKey) => {
  const { hero, skill, raw } = bound(skillKey);
  const clientFile = sourceFile(hero, "client");
  const officialZhFile = sourceFile(hero, "zh");
  const officialEnFile = sourceFile(hero, "en");
  const field = (name) => raw[name] === undefined ? null : raw[name];
  return {
    hero: hero.id,
    heroName: hero.name,
    heroKey: hero.key,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath || hero.source.rootPath,
    spellPath: skill.binding,
    bindingAvailable: true,
    clientFile,
    clientSha256: hero.source.client.sha256,
    clientCompressedSha256: hero.source.client.compressedSha256 || fileSha(clientFile),
    clientBuild: hero.source.client.contentVersion || sourceVersion.build,
    officialZhFile,
    officialZhSha256: fileSha(officialZhFile),
    officialEnFile,
    officialEnSha256: fileSha(officialEnFile),
    currentBoundText: skill.currentTexts,
    raw: {
      dataValues: Object.fromEntries((raw.DataValues || []).map((item) => [item.name, item.values ? item.values.slice() : null])),
      calculations: raw.mSpellCalculations || {},
      spellCastTime: field("spellCastTime"),
      mCastTime: field("mCastTime"),
      spellTotalTime: field("spellTotalTime"),
      mChannelDuration: field("mChannelDuration"),
      cooldownTime: field("cooldownTime"),
      mana: field("mana"),
      manaValues: field("manaValues"),
      mMaxAmmo: field("mMaxAmmo"),
      mAmmoRechargeTime: field("mAmmoRechargeTime"),
      mDoesNotConsumeMana: field("mDoesNotConsumeMana"),
      mDoesNotConsumeCooldown: field("mDoesNotConsumeCooldown"),
    },
    officialEvidence: officialEvidence(hero.id, slotOf(skillKey)),
    currentTextPath: "输入包/来源绑定与当前文本.json -> " + hero.id + "/" + slotOf(skillKey) + "/currentTexts",
  };
};

const parameter = (parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder) => ({
  parameterKey,
  name,
  valueType,
  valueMode,
  fixedValue: fixedValue ?? null,
  levelValues: levelValues ? Object.fromEntries(levelValues.map((value, index) => [String(index + 1), value])) : null,
  description,
  sortOrder,
});
const fixed = (key, name, type, value, description, sortOrder) => parameter(key, name, type, "FIXED", value, null, description, sortOrder);
const skillLevels = (key, name, type, values, description, sortOrder) => parameter(key, name, type, "SKILL_LEVEL", null, values, description, sortOrder);
const runtime = (key, name, type, description, sortOrder) => parameter(key, name, type, "RUNTIME_INPUT", null, null, description, sortOrder);
const P = (parameterKey) => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const add = (left, right) => O("ADD", left, right);
const mul = (left, right) => O("MULTIPLY", left, right);
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const AD_TOTAL = () => A("SOURCE", "attack_damage", "TOTAL");
const AD_BONUS = () => A("SOURCE", "attack_damage", "BONUS");
const AS_BONUS = () => A("SOURCE", "bonus_attack_speed_percent", "TOTAL");
const HP_TOTAL = () => A("SOURCE", "hp", "TOTAL");
const TARGET_HP_TOTAL = () => A("TARGET", "hp", "TOTAL");
const timedLifecycle = (durationParameterKey) => ({
  durationValue: { kind: "PARAMETER", parameterKey: durationParameterKey },
  maxStacksValue: { kind: "FIXED", value: 1 },
  applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope: "SOURCE",
  reapplicationStackMode: "KEEP",
  reapplicationDurationMode: "REFRESH_ALL",
  expiryMode: "ALL_AT_ONCE",
  periodicIntervalValue: null,
  firstPeriodicExecution: null,
});
const valueRule = (value) => ({ value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const persistentBehavior = () => ({
  moment: "PERSISTENT",
  valueReadMode: "APPLICATION_SNAPSHOT",
  stackValueMode: "SHARED",
  reapplicationValueMode: "REPLACE",
  periodicExecutionMode: null,
});
const attributeEffect = (effectKey, name, value, attributeKey, operation, durationKey, description, sortOrder) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: timedLifecycle(durationKey),
  results: [{
    resultKey: "attribute",
    name,
    resultType: "ATTRIBUTE_CHANGE",
    target: "SOURCE",
    description: "只定义来源明确的自身属性变化；触发事件由后续事件层接线。",
    sortOrder: 10,
    lifecycleBehavior: persistentBehavior(),
    spellShieldBlockScope: null,
    valueRule: valueRule(value),
    detail: { attributeKey, operation, modifierZoneKey: "attribute_flat_add" },
  }],
});
const normalShieldEffect = (effectKey, name, value, durationKey, description, sortOrder) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: timedLifecycle(durationKey),
  results: [{
    resultKey: "shield",
    name,
    resultType: "NORMAL_SHIELD",
    target: "SOURCE",
    description: "只定义来源明确的自身普通护盾数值；触发和移除事件由后续事件层接线。",
    sortOrder: 10,
    lifecycleBehavior: persistentBehavior(),
    spellShieldBlockScope: null,
    valueRule: valueRule(value),
    detail: { absorbedDamageTypeKey: null, decayMode: "NONE" },
  }],
});

const writes = {};
const excluded = {};
const pending = {};
const notes = {};
const formulaSourceNames = {};
const put = (skillKey, parameters, formulas, effects, excludedItems, pendingItems, proofNote, sourceNames = {}) => {
  writes[skillKey] = { parameters, formulas, effects, processes: [], internalStates: [], triggerRules: [] };
  excluded[skillKey] = excludedItems;
  pending[skillKey] = pendingItems;
  notes[skillKey] = proofNote;
  formulaSourceNames[skillKey] = sourceNames;
};

// 阿克尚：被动
put("akshan_p", [
  fixed("max_stack_count", "无所不用三次命中最大层数", "INTEGER", at("akshan_p", "MaxStacks"), "当前DataValues.MaxStacks=3；三次命中事件与目标资格留给事件层。", 10),
  fixed("second_attack_ad_ratio", "额外射击总攻击力比例", "DECIMAL", at("akshan_p", "SecondAutoADRatio"), "当前SecondAutoDamage的mStat=2且未给formula，按同版窄证读取来源总攻击力。", 20),
  fixed("second_attack_crit_efficiency_ratio", "额外射击暴击效能比例", "DECIMAL", at("akshan_p", "SecondAutoCritRatio"), "当前正文明确第二次攻击可暴击且效能为100%；保留比例1。", 30),
  fixed("second_attack_range_points", "额外射击攻击距离", "INTEGER", at("akshan_p", "SecondAutoFlexedAttackRange"), "当前DataValues.SecondAutoFlexedAttackRange=200；只保存来源数值，不建攻击事件。", 40),
  fixed("haste_duration_ms", "取消额外射击后移动速度持续时间（毫秒）", "INTEGER", ms(at("akshan_p", "HasteDuration")), "当前HasteDuration=1秒，转换为1000毫秒。", 50),
  fixed("move_speed_base_min", "取消射击移动速度角色等级下限", "INTEGER", calcPart("akshan_p", "MS").mStartValue, "当前MS为角色等级插值20至75；只保留端点，未知中间曲线使用运行输入。", 60),
  fixed("move_speed_base_max", "取消射击移动速度角色等级上限", "INTEGER", calcPart("akshan_p", "MS").mEndValue, "当前MS为角色等级插值20至75；只保留端点，未知中间曲线使用运行输入。", 70),
  runtime("move_speed_base_at_character_level", "取消射击角色等级移动速度基础值", "DECIMAL", "当前ASModdedMS先消费MS角色等级插值，再乘1+额外攻击速度；中间等级曲线未证，无默认值。", 80),
  fixed("move_speed_multiplier_base", "取消射击移动速度基础倍率", "DECIMAL", 1, "当前ASModdedMS的倍率树含Number=1。", 90),
  fixed("passive_proc_base_damage", "三次命中基础魔法伤害角色等级起点", "INTEGER", calcPart("akshan_p", "PassiveProcDamage").mLevel1Value, "当前PassiveProcDamage角色等级起点15。", 100),
  fixed("passive_proc_breakpoint_1_level", "三次命中魔法伤害第一次断点等级", "INTEGER", calcPart("akshan_p", "PassiveProcDamage").mBreakpoints[0].mLevel, "当前PassiveProcDamage第一断点为6级。", 110),
  fixed("passive_proc_breakpoint_1_increase", "三次命中魔法伤害第一次增加", "INTEGER", calcPart("akshan_p", "PassiveProcDamage").mBreakpoints[0].mAdditionalBonusAtThisLevel, "当前6级增加25点。", 120),
  fixed("passive_proc_breakpoint_2_level", "三次命中魔法伤害第二次断点等级", "INTEGER", calcPart("akshan_p", "PassiveProcDamage").mBreakpoints[1].mLevel, "当前PassiveProcDamage第二断点为11级。", 130),
  fixed("passive_proc_breakpoint_2_increase", "三次命中魔法伤害第二次增加", "INTEGER", calcPart("akshan_p", "PassiveProcDamage").mBreakpoints[1].mAdditionalBonusAtThisLevel, "当前11级增加40点。", 140),
  fixed("passive_proc_breakpoint_3_level", "三次命中魔法伤害第三次断点等级", "INTEGER", calcPart("akshan_p", "PassiveProcDamage").mBreakpoints[2].mLevel, "当前PassiveProcDamage第三断点为16级。", 150),
  fixed("passive_proc_breakpoint_3_increase", "三次命中魔法伤害第三次增加", "INTEGER", calcPart("akshan_p", "PassiveProcDamage").mBreakpoints[2].mAdditionalBonusAtThisLevel, "当前16级增加70点。", 160),
  runtime("passive_proc_base_damage_at_character_level", "三次命中角色等级基础伤害实际值", "DECIMAL", "当前PassiveProcDamage的断点求值循环未证；运行层须提供角色等级实际基础值，不能按端点线性猜测。", 170),
  fixed("passive_proc_ap_ratio", "三次命中法术强度比例", "DECIMAL", at("akshan_p", "APRatio"), "当前PassiveProcDamage第二项为APRatio×法术强度，mStat省略按同版窄证读取法强。", 180),
  fixed("shield_base_min", "英雄目标护盾角色等级下限", "INTEGER", calcPart("akshan_p", "TotalShieldAmount").mStartValue, "当前TotalShieldAmount角色等级插值下限40。", 190),
  fixed("shield_base_max", "英雄目标护盾角色等级上限", "INTEGER", calcPart("akshan_p", "TotalShieldAmount").mEndValue, "当前TotalShieldAmount角色等级插值上限280。", 200),
  runtime("shield_base_at_character_level", "英雄目标护盾角色等级基础值", "DECIMAL", "当前TotalShieldAmount角色等级插值中间曲线未证；运行层提供实际角色等级基础值，无默认。", 210),
  fixed("shield_bonus_ad_ratio", "英雄目标护盾额外攻击力比例", "DECIMAL", at("akshan_p", "ShieldBADRatio"), "当前TotalShieldAmount的mStat=2、mStatFormula=2，按来源额外攻击力读取。", 220),
  fixed("shield_duration_ms", "英雄目标护盾持续时间（毫秒）", "INTEGER", ms(at("akshan_p", "ShieldDuration")), "当前ShieldDuration=2秒，转换为2000毫秒。", 230),
  fixed("passive_cooldown_base_ms", "三次命中护盾基础冷却（毫秒）", "INTEGER", ms(calcPart("akshan_p", "PassiveCooldown").mLevel1Value), "当前PassiveCooldown角色等级起点16秒，转换为16000毫秒。", 240),
  fixed("passive_cooldown_reduction_ms", "三次命中护盾每次冷却减少（毫秒）", "INTEGER", ms(Math.abs(calcPart("akshan_p", "PassiveCooldown").mBreakpoints[0].mAdditionalBonusAtThisLevel)), "当前6/11/16级各减少4秒；保存正的减少幅度。", 250),
  fixed("passive_cooldown_breakpoint_1_level", "三次命中护盾第一次冷却断点等级", "INTEGER", calcPart("akshan_p", "PassiveCooldown").mBreakpoints[0].mLevel, "当前第一次冷却断点为6级。", 260),
  fixed("passive_cooldown_breakpoint_2_level", "三次命中护盾第二次冷却断点等级", "INTEGER", calcPart("akshan_p", "PassiveCooldown").mBreakpoints[1].mLevel, "当前第二次冷却断点为11级。", 270),
  fixed("passive_cooldown_breakpoint_3_level", "三次命中护盾第三次冷却断点等级", "INTEGER", calcPart("akshan_p", "PassiveCooldown").mBreakpoints[2].mLevel, "当前第三次冷却断点为16级。", 280),
], [
  formula("second_attack_physical_damage", "额外射击物理伤害", mul(P("second_attack_ad_ratio"), AD_TOTAL()), "当前SecondAutoDamage=SecondAutoADRatio×来源总攻击力。", 10),
  formula("passive_proc_magic_damage", "三次命中额外魔法伤害", add(P("passive_proc_base_damage_at_character_level"), mul(P("passive_proc_ap_ratio"), AP())), "当前PassiveProcDamage=角色等级断点基础值+APRatio×来源总法术强度；断点基础值由运行层提供。", 20),
  formula("champion_shield_value", "英雄目标护盾值", add(P("shield_base_at_character_level"), mul(P("shield_bonus_ad_ratio"), AD_BONUS())), "当前TotalShieldAmount=角色等级基础值+ShieldBADRatio×来源额外攻击力；护盾仅在英雄目标分支成立时应用。", 30),
  formula("cancelled_second_attack_move_speed", "取消额外射击后的移动速度", mul(P("move_speed_base_at_character_level"), add(P("move_speed_multiplier_base"), AS_BONUS())), "当前ASModdedMS=MS×(1+额外攻击速度)；mStat=4/formula=2按额外攻击速度属性读取。", 40),
], [
  normalShieldEffect("champion_shield", "无所不用英雄目标自身护盾", { kind: "FORMULA", formulaKey: "champion_shield_value" }, "shield_duration_ms", "当前正文明确命中英雄获得2秒护盾；只定义自身护盾，三次命中和英雄目标事件待接。", 30),
], [
  { item: "第二次攻击对小兵的100%总攻击力分支", reason: "当前扩展正文是非英雄专用说明，本轮只保留英雄/单一敌人主路径，不建立兵野分支。" },
  { item: "第二次攻击暴击计算树", reason: "当前暴击效能值已保存，但mStat9属性枚举和实际暴击事件未在本轮接线。" },
], [
  { item: "第三次命中、护盾英雄资格和冷却重置", reason: "保留层数、冷却和护盾数值；触发事件、目标资格和断点求值时点待接。" },
  { item: "取消射击后的衰减过程", reason: "保留角色等级基础端点、额外攻速乘算和持续时间；衰减曲线与取消时点未证。" },
], "阿克尚P沿当前正文消费的SecondAutoDamage、PassiveProcDamage、TotalShieldAmount和ASModdedMS分别保存；金币、友方复活和未展开旧树不进入候选。", {
  second_attack_physical_damage: ["SecondAutoDamage"],
  passive_proc_magic_damage: ["PassiveProcDamage"],
  champion_shield_value: ["TotalShieldAmount"],
  cancelled_second_attack_move_speed: ["ASModdedMS", "MS"],
});

// 阿克尚：Q
put("akshan_q", [
  skillLevels("base_damage", "去而复还基础物理伤害", "INTEGER", levels("akshan_q", "BaseDamage", 5), "当前DataValues.BaseDamage技能等级1至5为45/75/105/135/165；索引0为旧占位15。", 10),
  fixed("bonus_ad_ratio", "去而复还额外攻击力比例", "DECIMAL", at("akshan_q", "ADRatio"), "当前FinalDamage的mStat=2、mStatFormula=2，按来源额外攻击力读取，不能写成总攻击力。", 20),
  fixed("haste_base_ratio", "命中英雄基础移动速度比例", "DECIMAL", at("akshan_q", "HasteValue"), "当前TotalHaste基础值0.2，正文按比例显示。", 30),
  fixed("haste_ap_ratio", "命中英雄法术强度移动速度比例", "DECIMAL", at("akshan_q", "HasteAPRatio"), "当前TotalHaste第二项为0.0005×来源总法术强度，结果按百分比显示。", 40),
  fixed("haste_duration_ms", "命中英雄移动速度持续时间（毫秒）", "INTEGER", ms(at("akshan_q", "HasteDuration")), "当前HasteDuration=1秒，转换为1000毫秒。", 50),
], [
  formula("physical_damage", "去而复还单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前FinalDamage=BaseDamage+ADRatio×来源额外攻击力；去程与返程命中同一敌人各自由事件层结算。", 10),
  formula("champion_hit_haste_ratio", "命中英雄自身移动速度比例", add(P("haste_base_ratio"), mul(P("haste_ap_ratio"), AP())), "当前TotalHaste=HasteValue+HasteAPRatio×来源总法术强度；正文按百分比显示。", 20),
], [
  attributeEffect("champion_hit_move_speed", "去而复还命中英雄自身移动速度", { kind: "FORMULA", formulaKey: "champion_hit_haste_ratio" }, "move_speed_percent", "INCREASE", "haste_duration_ms", "当前正文明确命中英雄给予自身短暂移动速度；命中和衰减事件待接。", 30),
], [
  { item: "非英雄单位伤害倍率", reason: "SecondaryTargetDamage是兵野专用分支，本轮按单一敌方英雄范围排除。" },
  { item: "被命中敌人显形时长和投射物距离", reason: "属于视野或空间几何，不进入本轮单一敌人伤害公式。" },
], [
  { item: "去程/返程命中事件", reason: "同一敌人两次命中均保留同一伤害公式；实际命中次数、施法与移动速度衰减待接。" },
], "阿克尚Q使用FinalDamage的额外攻击力选择器和TotalHaste法强项；不把mStat=2/formula=2误写成总攻击力。", {
  physical_damage: ["FinalDamage"],
  champion_hit_haste_ratio: ["TotalHaste"],
});

// 阿克尚：W
put("akshan_w", [
  fixed("scoundrel_mark_duration_ms", "恶人标记持续时间（毫秒）", "INTEGER", ms(at("akshan_w", "VengeanceDuration")), "当前正文与DataValues.VengeanceDuration明确恶人标记60秒，转换为60000毫秒；标记资格仍由事件提供。", 10),
  skillLevels("move_speed_points", "赴险夺人朝恶人移动速度", "INTEGER", levels("akshan_w", "MSValue", 5), "当前GameModeInteger=1展开的正文消费MSValue，技能等级1至5为80/90/100/110/120移动速度点。", 20),
  fixed("missing_mana_regen_ratio", "赴险夺人已损法力回复比例", "DECIMAL", at("akshan_w", "MissingManaRegen"), "当前展开正文明确朝恶人移动时获得12%已损法力回复；未推断回复周期。", 30),
  fixed("wall_grace_period_ms", "离开墙体或草丛后的伪装宽限时间（毫秒）", "INTEGER", ms(at("akshan_w", "WallGracePeriod")), "当前WallGracePeriod=2秒，转换为2000毫秒。", 40),
], [], [], [
  { item: "金币、队友复活和金币显示", reason: "纯金币、第三友方复活和展示分支超出本轮单一来源范围。" },
  { item: "SecondAutoDamage、PassiveSecondAutoRatio和ShredValue", reason: "当前正文由GameModeInteger模板展开后未消费这些旧计算树节点；不把旧树写成W战斗组成。" },
], [
  { item: "恶人资格、朝恶人条件、伪装应用和法力回复时序", reason: "自身收益数值已保存；恶人标记、活着条件、离墙伪装和回复事件待接。" },
], "阿克尚W按当前GameModeInteger=1展开正文保留自身移动速度、已损法力回复和离墙宽限；未用回蓝周期或未消费匿名树补公式。", {});

// 阿克尚：E
put("akshan_e", [
  skillLevels("shot_base_damage", "骄行荡寇每发基础物理伤害", "INTEGER", levels("akshan_e", "BaseDamage", 5), "当前DamageToDeal的BaseDamage技能等级1至5为8/16/24/32/40。", 10),
  fixed("total_ad_ratio", "骄行荡寇总攻击力比例", "DECIMAL", at("akshan_e", "ADRatio"), "当前DamageToDeal的mStat=2且未给formula；沿同版窄证取来源总攻击力。", 20),
  fixed("extra_attack_speed_ratio", "骄行荡寇额外攻击速度系数", "DECIMAL", at("akshan_e", "AttackSpeedCoefficient"), "当前DamageToDeal倍率树消费0.3×额外攻击速度，正文显示30%额外攻击速度。", 30),
  fixed("damage_multiplier_base", "骄行荡寇伤害基础倍率", "DECIMAL", 1, "当前DamageToDeal倍率树含Number=1，再乘1+0.3×额外攻击速度。", 35),
  fixed("on_hit_effectiveness_ratio", "骄行荡寇攻击特效效能比例", "DECIMAL", at("akshan_e", "OnHitDamageReduction"), "当前扩展正文明确摆荡时攻击特效效能为25%；不创建攻击特效事件。", 40),
  fixed("reset_cooldown_ms", "骄行荡寇击杀刷新后的冷却时间（毫秒）", "INTEGER", ms(at("akshan_e", "ResetCooldownToSet")), "当前ResetCooldownToSet=0.5秒，转换为500毫秒；刷新事件待接。", 50),
  fixed("attack_frequency_source_value", "骄行荡寇攻击频率原始值", "DECIMAL", at("akshan_e", "AttackFrequency"), "当前DataValues.AttackFrequency=0.2；当前正文未给时间单位，只保存无单位原始值，不换算毫秒或推导发数。", 60),
  fixed("second_cast_window_ms", "骄行荡寇第二段施放时序窗口（毫秒）", "INTEGER", ms(at("akshan_e", "TimeToCastE2")), "当前TimeToCastE2=2秒，转换为2000毫秒；不据此推导射击总数。", 70),
  fixed("critical_damage_mod_ratio", "骄行荡寇暴击伤害修正系数", "DECIMAL", at("akshan_e", "CritDamageMod"), "当前CriticalCalc的CritDamageMod=0.5；当前树明确将其乘入mStat9-1，不映射成现有属性。", 80),
  runtime("critical_mstat9_value", "骄行荡寇CriticalCalc的mStat9实际输入", "DECIMAL", "当前扩展正文明确消费CriticalCalc，树使用mStat9；属性枚举、暴击资格和实际触发待接，运行层必须提供实际值，无默认。", 90),
  fixed("critical_stat_offset", "骄行荡寇暴击属性减一偏移", "DECIMAL", -1, "当前CriticalCalc明确计算mStat9-1；用显式偏移保留原树。", 100),
], [
  formula("shot_physical_damage", "骄行荡寇单发物理伤害", mul(add(P("shot_base_damage"), mul(P("total_ad_ratio"), AD_TOTAL())), add(P("damage_multiplier_base"), mul(P("extra_attack_speed_ratio"), AS_BONUS()))), "当前DamageToDeal=(BaseDamage+0.25×来源总攻击力)×(1+0.3×额外攻击速度)；逐发公式，不创建伤害结果。", 10),
  formula("critical_shot_physical_damage", "骄行荡寇单发暴击物理伤害", mul(mul(add(P("shot_base_damage"), mul(P("total_ad_ratio"), AD_TOTAL())), add(P("damage_multiplier_base"), mul(P("extra_attack_speed_ratio"), AS_BONUS()))), add(P("damage_multiplier_base"), mul(P("critical_damage_mod_ratio"), add(P("critical_mstat9_value"), P("critical_stat_offset"))))), "当前CriticalCalc=DamageToDeal×(1+CritDamageMod×(mStat9-1))；完整暴击单发树保留，mStat9实际输入无默认。", 20),
], [], [
  { item: "SpinDuration作为持续时间或AttackFrequency作为发数", reason: "当前SpinDuration为内部节拍窗口，AttackFrequency为间隔；没有发数树，不作线性展开。" },
], [
  { item: "钩爪、摆荡、逐发次数、碰撞提前结束和击杀刷新", reason: "保留每发伤害、节拍和刷新冷却数值；空间、发数和事件时序待接。" },
  { item: "CriticalCalc的mStat9属性资格与暴击触发事件", reason: "当前扩展正文明确消费CriticalCalc；完整乘区、CritDamageMod和无默认mStat9输入已保留，属性枚举、资格与触发事件待接。" },
], "阿克尚E保留DamageToDeal逐发物理伤害及CriticalCalc完整暴击乘区；AttackFrequency只保存无单位原始0.2，不换算毫秒或推导发数。", { shot_physical_damage: ["DamageToDeal"], critical_shot_physical_damage: ["CriticalCalc", "DamageToDeal"] });

// 阿克尚：R
put("akshan_r", [
  skillLevels("bonus_damage", "恩怨相抵每颗子弹基础物理伤害", "INTEGER", levels("akshan_r", "BonusDamage", 3), "当前BonusDamage技能等级1至3为25/35/45；索引0为旧占位15。", 10),
  fixed("total_ad_ratio", "恩怨相抵总攻击力比例", "DECIMAL", at("akshan_r", "ADRatio"), "当前DamagePerBulletWithCrit的mStat=2且未给formula；沿同版窄证取来源总攻击力。", 20),
  fixed("critical_damage_effectiveness_ratio", "恩怨相抵暴击伤害修正系数", "DECIMAL", at("akshan_r", "CritDamageMod"), "当前DamagePerBulletWithCrit的mMultiplier明确消费CritDamageMod=0.3；不把mStat8/9映射成现有属性。", 30),
  fixed("critical_multiplier_base", "恩怨相抵暴击倍率基础值", "DECIMAL", 1, "当前DamagePerBulletWithCrit的mMultiplier含Number=1。", 35),
  runtime("critical_mstat8_value", "恩怨相抵暴击mStat8实际输入", "DECIMAL", "当前DamagePerBulletWithCrit的mMultiplier使用mStat8；属性枚举、暴击资格待接，运行层必须提供实际值，无默认。", 36),
  runtime("critical_mstat9_value", "恩怨相抵暴击mStat9实际输入", "DECIMAL", "当前DamagePerBulletWithCrit的mMultiplier使用mStat9；属性枚举、暴击资格待接，运行层必须提供实际值，无默认。", 37),
  fixed("critical_stat_offset", "恩怨相抵暴击属性减一偏移", "DECIMAL", -1, "当前DamagePerBulletWithCrit明确计算mStat9-1；用显式偏移保留原树。", 38),
  fixed("max_increase_multiplier", "恩怨相抵已损生命最高伤害倍率", "DECIMAL", at("akshan_r", "MaxIncrease"), "当前MaxDamagePerBullet将DamagePerBulletWithCrit乘3。", 40),
  fixed("channel_duration_ms", "恩怨相抵最大充能时间（毫秒）", "INTEGER", ms(at("akshan_r", "ChannelDuration")), "当前ChannelDuration=2.5秒，转换为2500毫秒。", 50),
  fixed("grace_cooldown_ms", "恩怨相抵宽限冷却时间（毫秒）", "INTEGER", ms(at("akshan_r", "GraceCooldown")), "当前GraceCooldown=5秒，转换为5000毫秒。", 60),
  fixed("cast_time_per_bullet_ms", "恩怨相抵每颗子弹发射时长（毫秒）", "INTEGER", ms(at("akshan_r", "CastTimePerBullet")), "当前CastTimePerBullet=0.15秒，转换为150毫秒。", 70),
  fixed("minimum_channel_duration_ms", "恩怨相抵最小充能时间（毫秒）", "INTEGER", ms(at("akshan_r", "MinimumChannelDuration")), "当前MinimumChannelDuration=0.5秒，转换为500毫秒。", 80),
  skillLevels("bullet_count", "恩怨相抵最大子弹数", "INTEGER", levels("akshan_r", "NumberOfBullets", 3), "当前NumberOfBullets技能等级1至3为5/6/7。", 90),
], [
  formula("damage_per_bullet", "恩怨相抵每颗子弹含暴击乘区的物理伤害", mul(add(P("bonus_damage"), mul(P("total_ad_ratio"), AD_TOTAL())), add(P("critical_multiplier_base"), mul(P("critical_mstat8_value"), mul(P("critical_damage_effectiveness_ratio"), add(P("critical_mstat9_value"), P("critical_stat_offset")))))), "当前DamagePerBulletWithCrit=(BonusDamage+0.15×来源总攻击力)×(1+mStat8×0.3×(mStat9-1))；完整mMultiplier保留，mStat8/9实际输入无默认。", 10),
  formula("max_damage_per_bullet", "恩怨相抵每颗子弹最高物理伤害", mul(mul(add(P("bonus_damage"), mul(P("total_ad_ratio"), AD_TOTAL())), add(P("critical_multiplier_base"), mul(P("critical_mstat8_value"), mul(P("critical_damage_effectiveness_ratio"), add(P("critical_mstat9_value"), P("critical_stat_offset")))))), P("max_increase_multiplier")), "当前MaxDamagePerBullet=完整DamagePerBulletWithCrit×MaxIncrease；已损生命中间曲线未编。", 20),
], [], [
  { item: "小兵处决、生命偷取和建筑物分支", reason: "当前扩展文本和首个敌人选择包含兵野/建筑专用收益，本轮只保留单一敌方英雄伤害主路径。" },
], [
  { item: "mStat8/mStat9属性资格、暴击事件与已损生命中间曲线", reason: "当前树已明确含完整暴击mMultiplier并保留两个无默认输入；属性枚举、暴击事件和已损生命中间曲线待接，不作端点线性猜测。" },
  { item: "充能子弹数量和逐发时序", reason: "只保存子弹数量、基础树和最高倍率，充能与发射事件待接。" },
], "阿克尚R沿DamagePerBulletWithCrit和MaxDamagePerBullet保留完整暴击乘区及最高倍率；未知已损生命曲线不作端点线性猜测。", { damage_per_bullet: ["DamagePerBulletWithCrit"], max_damage_per_bullet: ["MaxDamagePerBullet", "DamagePerBulletWithCrit"] });

// 安蓓萨：P
put("ambessa_p", [
  fixed("buffer_dash_time_ms", "龙犬诡步指令缓冲时间（毫秒）", "INTEGER", ms(at("ambessa_p", "Buffer_Dash_Time")), "当前Buffer_Dash_Time=0.3秒，转换为300毫秒。", 10),
  fixed("buffer_dash_distance", "龙犬诡步指令缓冲冲刺距离", "INTEGER", at("ambessa_p", "Buffer_Dash_Distance"), "当前Buffer_Dash_Distance=350；空间位移只保留来源值。", 20),
  fixed("buffer_dash_min_distance", "龙犬诡步冲刺最小距离", "INTEGER", at("ambessa_p", "Buffer_Dash_Min_Distance"), "当前Buffer_Dash_Min_Distance=175。", 30),
  fixed("buffer_dash_forgiveness_window_ms", "龙犬诡步普通宽限时间（毫秒）", "INTEGER", ms(at("ambessa_p", "Buffer_Dash_Forgiveness_Window")), "当前普通宽限0.275秒，转换为275毫秒。", 40),
  fixed("buffer_dash_w_forgiveness_window_ms", "龙犬诡步W宽限时间（毫秒）", "INTEGER", ms(at("ambessa_p", "Buffer_Dash_W_Forgiveness_Window")), "当前W宽限0.25秒，转换为250毫秒。", 50),
  fixed("buffer_dash_wall_forgiveness", "龙犬诡步墙体宽限距离", "INTEGER", at("ambessa_p", "Buffer_Dash_Wall_Forgiveness"), "当前墙体宽限500；只记录空间资格输入。", 60),
  fixed("attack_range_bonus_points", "龙犬诡步强化攻击额外距离", "INTEGER", at("ambessa_p", "Attack_Range_Amount"), "当前强化攻击额外距离75点。", 70),
  fixed("attack_range_total_points", "龙犬诡步强化攻击总距离", "INTEGER", at("ambessa_p", "Attack_Range_Total"), "当前Attack_Range_Total=200点。", 80),
  fixed("attack_max_stack_count", "龙犬诡步强化攻击最大层数", "INTEGER", at("ambessa_p", "Attack_Buff_Max_Stacks"), "当前最多3层。", 90),
  fixed("attack_buff_duration_ms", "龙犬诡步强化攻击层持续时间（毫秒）", "INTEGER", ms(at("ambessa_p", "Attack_Buff_Duration")), "当前Attack_Buff_Duration=4秒，转换为4000毫秒。", 100),
  fixed("attack_speed_bonus_ratio", "龙犬诡步强化攻击速度比例", "DECIMAL", at("ambessa_p", "Attack_Speed"), "当前正文以Attack_Speed百分比显示50%攻击速度。", 110),
  fixed("on_hit_base_damage_min", "龙犬诡步强化攻击角色等级伤害下限", "INTEGER", calcPart("ambessa_p", "Calc_OnHit_Damage_Flat").mStartValue, "当前Calc_OnHit_Damage_Flat角色等级插值下限5。", 120),
  fixed("on_hit_base_damage_max", "龙犬诡步强化攻击角色等级伤害上限", "INTEGER", calcPart("ambessa_p", "Calc_OnHit_Damage_Flat").mEndValue, "当前Calc_OnHit_Damage_Flat角色等级插值上限30。", 130),
  runtime("on_hit_base_damage_at_character_level", "龙犬诡步强化攻击角色等级基础伤害", "DECIMAL", "当前Calc_OnHit_Damage_Flat的角色等级中间插值未证；运行层提供实际基础值，无默认。", 140),
  fixed("on_hit_bonus_ad_ratio", "龙犬诡步强化攻击额外攻击力比例", "DECIMAL", coefficient("ambessa_p", "Calc_OnHit_Damage_Flat", 1), "当前Calc_OnHit_Damage_Flat第二项mStat=2、mStatFormula=2、系数0.25，读取来源额外攻击力。", 150),
  fixed("energy_refund_base", "龙犬诡步强化攻击基础能量回复", "INTEGER", calcPart("ambessa_p", "Calc_OnHit_Energy_Refund").mLevel1Value, "当前能量回复角色等级起点40。", 160),
  fixed("energy_refund_increase", "龙犬诡步强化攻击能量回复断点增量", "INTEGER", calcPart("ambessa_p", "Calc_OnHit_Energy_Refund").mBreakpoints[0].mAdditionalBonusAtThisLevel, "当前7级和13级各增加15；不猜断点累计算法。", 170),
  fixed("energy_refund_breakpoint_1_level", "龙犬诡步能量回复第一次断点等级", "INTEGER", calcPart("ambessa_p", "Calc_OnHit_Energy_Refund").mBreakpoints[0].mLevel, "当前第一次断点为7级。", 180),
  fixed("energy_refund_breakpoint_2_level", "龙犬诡步能量回复第二次断点等级", "INTEGER", calcPart("ambessa_p", "Calc_OnHit_Energy_Refund").mBreakpoints[1].mLevel, "当前第二次断点为13级。", 190),
], [
  formula("on_hit_physical_damage", "龙犬诡步强化攻击物理伤害", add(P("on_hit_base_damage_at_character_level"), mul(P("on_hit_bonus_ad_ratio"), AD_BONUS())), "当前Calc_OnHit_Damage_Flat=角色等级基础值+0.25×来源额外攻击力；中间等级基础值运行提供。", 10),
], [
  attributeEffect("attack_speed_bonus", "龙犬诡步强化攻击自身攻击速度", { kind: "PARAMETER", parameterKey: "attack_speed_bonus_ratio" }, "bonus_attack_speed_percent", "INCREASE", "attack_buff_duration_ms", "当前充能期间给自身50%攻击速度；层数消费和施放事件待接。", 20),
  attributeEffect("attack_range_bonus", "龙犬诡步强化攻击自身攻击距离", { kind: "PARAMETER", parameterKey: "attack_range_bonus_points" }, "attack_range", "INCREASE", "attack_buff_duration_ms", "当前充能期间给自身额外攻击距离；层数消费和施放事件待接。", 30),
], [
  { item: "未消费mStat7匿名公式和空插值匿名树", reason: "当前正文与可见消费树未使用这些节点，不把未知属性或内部插值树写成机制组成。" },
], [
  { item: "指令缓冲、冲刺、强化攻击层消费和能量回复断点求值", reason: "保留位移、层数、强化攻击公式和能量断点；实际时序、资源变更和断点算法待接。" },
], "安蓓萨P保留自主位移资格、强化攻击、攻击速度/距离和能量回复来源；未把mStat7匿名节点当作额外属性，也未自动创建资源变化。", { on_hit_physical_damage: ["Calc_OnHit_Damage_Flat"] });

// 安蓓萨：Q
put("ambessa_q", [
  fixed("swap_duration_ms", "暗袭/裂斩形态准备持续时间（毫秒）", "INTEGER", ms(at("ambessa_q", "Swap_Duration")), "当前Swap_Duration=4秒，转换为4000毫秒。", 10),
  fixed("swap_static_cooldown_ms", "暗袭/裂斩形态静态冷却（毫秒）", "INTEGER", ms(at("ambessa_q", "Swap_Static_Cooldown")), "当前Swap_Static_Cooldown=0.5秒，转换为500毫秒。", 20),
  skillLevels("damage_1_base", "暗袭基础物理伤害", "INTEGER", levels("ambessa_q", "Damage_1_Base", 5), "当前Damage_1_Base技能等级1至5为40/60/80/100/120。", 30),
  skillLevels("damage_1_max_health_base_ratio", "暗袭目标最大生命基础比例", "DECIMAL", levels("ambessa_q", "Damage_1_Percent", 5), "当前Calc_Damage_1_Percent_Max正文乘目标最大生命并按百分比显示；按原始技能等级数组保存比例。", 40),
  fixed("damage_1_max_health_bonus_ad_ratio", "暗袭目标最大生命额外攻击力比例", "DECIMAL", coefficient("ambessa_q", "Calc_Damage_1_Percent_Max", 1), "当前Calc_Damage_1_Percent_Max第二项mStat=2、mStatFormula=2、系数0.0003；是最大生命百分比中的额外攻击力项。", 50),
  skillLevels("damage_2_base", "裂斩基础物理伤害", "INTEGER", levels("ambessa_q", "Damage_2_Base", 5), "当前Damage_2_Base技能等级1至5为50/75/100/125/150。", 60),
  skillLevels("damage_2_max_health_base_ratio", "裂斩目标最大生命基础比例", "DECIMAL", levels("ambessa_q", "Damage_2_Percent", 5), "当前Calc_Damage_2_Percent_Max正文乘目标最大生命并按百分比显示；按原始技能等级数组保存比例。", 70),
  fixed("damage_2_max_health_bonus_ad_ratio", "裂斩目标最大生命额外攻击力比例", "DECIMAL", coefficient("ambessa_q", "Calc_Damage_2_Percent_Max", 1), "当前Calc_Damage_2_Percent_Max第二项mStat=2、mStatFormula=2、系数0.0004；是最大生命百分比中的额外攻击力项。", 80),
  fixed("damage_1_bonus_ad_ratio", "暗袭额外攻击力伤害比例", "DECIMAL", at("ambessa_q", "Damage_1_BAD_Ratio"), "当前Calc_Damage_1_Max的mStat=2、mStatFormula=2，系数0.6为来源额外攻击力。", 90),
  fixed("damage_2_bonus_ad_ratio", "裂斩额外攻击力伤害比例", "DECIMAL", at("ambessa_q", "Damage_2_BAD_Ratio"), "当前Calc_Damage_2_Max的mStat=2、mStatFormula=2，系数0.9为来源额外攻击力。", 100),
], [
  formula("damage_1_edge_physical_damage", "暗袭边缘单一敌人基础物理伤害", add(P("damage_1_base"), mul(P("damage_1_bonus_ad_ratio"), AD_BONUS())), "当前Calc_Damage_1_Max=Damage_1_Base+0.6×来源额外攻击力；目标最大生命比例另行保存。", 10),
  formula("damage_1_max_health_ratio", "暗袭目标最大生命伤害比例", add(P("damage_1_max_health_base_ratio"), mul(P("damage_1_max_health_bonus_ad_ratio"), AD_BONUS())), "当前Calc_Damage_1_Percent_Max=基础百分比+0.0003×来源额外攻击力，mDisplayAsPercent为真；目标最大生命由正文目标口径提供。", 20),
  formula("damage_2_first_physical_damage", "裂斩首个单一敌人基础物理伤害", add(P("damage_2_base"), mul(P("damage_2_bonus_ad_ratio"), AD_BONUS())), "当前Calc_Damage_2_Max=Damage_2_Base+0.9×来源额外攻击力；目标最大生命比例另行保存。", 30),
  formula("damage_2_max_health_ratio", "裂斩目标最大生命伤害比例", add(P("damage_2_max_health_base_ratio"), mul(P("damage_2_max_health_bonus_ad_ratio"), AD_BONUS())), "当前Calc_Damage_2_Percent_Max=基础百分比+0.0004×来源额外攻击力，mDisplayAsPercent为真；目标最大生命由正文目标口径提供。", 40),
], [], [
  { item: "其他敌人50%伤害（Damage_1_Min_Ratio/Damage_2_Min_Ratio）", reason: "当前正文明确其他敌人分支，本轮单一敌人只保留边缘/首个目标路径；该源值仅保留在来源树，不生成可写参数。" },
  { item: "野怪额外伤害和最大生命百分比封顶", reason: "Calc_Damage_Monster_Flat_Bonus与Calc_Damage_Monster_Percent_Cap是兵野专用分支。" },
], [
  { item: "两段形态切换和目标最大生命最终伤害组合", reason: "两段主树及最大生命比例均保留；形态准备、目标选择、首段/后续事件和目标最大生命最终乘法由事件接线。" },
], "安蓓萨Q保留暗袭/裂斩两段边缘或首个目标树；最大生命百分比公式按原mDisplayAsPercent比例保存，不把非英雄倍率或野怪封顶写入。", {
  damage_1_edge_physical_damage: ["Calc_Damage_1_Max"],
  damage_1_max_health_ratio: ["Calc_Damage_1_Percent_Max"],
  damage_2_first_physical_damage: ["Calc_Damage_2_Max"],
  damage_2_max_health_ratio: ["Calc_Damage_2_Percent_Max"],
});

// 安蓓萨：W
put("ambessa_w", [
  fixed("dash_delay_ms", "铁令冲刺延迟（毫秒）", "INTEGER", ms(at("ambessa_w", "Dash_Delay")), "当前Dash_Delay=0.225秒，转换为225毫秒。", 10),
  fixed("guard_window_ms", "铁令防守姿势持续时间（毫秒）", "INTEGER", ms(at("ambessa_w", "Buff_Duration")), "当前Buff_Duration=0.5秒，转换为500毫秒。", 20),
  fixed("shield_duration_ms", "铁令护盾持续时间（毫秒）", "INTEGER", ms(at("ambessa_w", "Shield_Duration")), "当前Shield_Duration=1.5秒，转换为1500毫秒。", 30),
  fixed("shield_base_min", "铁令护盾角色等级下限", "INTEGER", calcPart("ambessa_w", "Calc_Shield").mStartValue, "当前Calc_Shield角色等级插值下限50。", 40),
  fixed("shield_base_max", "铁令护盾角色等级上限", "INTEGER", calcPart("ambessa_w", "Calc_Shield").mEndValue, "当前Calc_Shield角色等级插值上限320。", 50),
  runtime("shield_base_at_character_level", "铁令护盾角色等级基础值", "DECIMAL", "当前Calc_Shield角色等级中间插值未证；运行层提供实际角色等级基础值，无默认。", 60),
  fixed("shield_bonus_ad_ratio", "铁令护盾额外攻击力比例", "DECIMAL", coefficient("ambessa_w", "Calc_Shield", 1), "当前Calc_Shield第二项mStat=2、mStatFormula=2、系数1.5，读取来源额外攻击力。", 70),
  skillLevels("base_damage", "铁令低伤害基础物理伤害", "INTEGER", levels("ambessa_w", "BaseDamage", 5), "当前BaseDamage技能等级1至5为50/75/100/125/150。", 80),
  fixed("damage_bonus_ad_ratio", "铁令低伤害额外攻击力比例", "DECIMAL", at("ambessa_w", "DamageADRatio"), "当前Calc_Damage_Low的mStat=2、mStatFormula=2，系数0.5为来源额外攻击力。", 90),
  fixed("high_damage_multiplier", "铁令格挡后伤害倍率", "DECIMAL", at("ambessa_w", "HighDamageMultiplier"), "当前Calc_Damage_High在低伤害基础上乘1.5；只保存来源倍率。", 100),
], [
  formula("shield_value", "铁令自身护盾值", add(P("shield_base_at_character_level"), mul(P("shield_bonus_ad_ratio"), AD_BONUS())), "当前Calc_Shield=角色等级基础值+1.5×来源额外攻击力。", 10),
  formula("low_physical_damage", "铁令低档单一敌人物理伤害", add(P("base_damage"), mul(P("damage_bonus_ad_ratio"), AD_BONUS())), "当前Calc_Damage_Low=BaseDamage+0.5×来源额外攻击力。", 20),
  formula("high_physical_damage", "铁令格挡后单一敌人物理伤害", mul(add(P("base_damage"), mul(P("damage_bonus_ad_ratio"), AD_BONUS())), P("high_damage_multiplier")), "当前Calc_Damage_High=Calc_Damage_Low×HighDamageMultiplier；格挡条件由事件层提供。", 30),
], [
  normalShieldEffect("self_shield", "铁令自身护盾", { kind: "FORMULA", formulaKey: "shield_value" }, "shield_duration_ms", "当前正文明确自身获得1.5秒护盾；防守姿势、护盾触发和移除事件待接。", 30),
], [
  { item: "低伤/高伤的自动选择", reason: "高档分支要求格挡非小兵单位伤害；只保存两档公式，不自动判断或触发。" },
], [
  { item: "护盾施放、格挡窗口和高档伤害事件", reason: "保留225毫秒延迟、500毫秒防守窗口和两档数值；事件资格待接。" },
], "安蓓萨W保留自身护盾及低档/格挡后两档伤害，严格按mStat2/formula2使用额外攻击力；护盾结果为NORMAL_SHIELD且显式空阻挡范围。", { shield_value: ["Calc_Shield"], low_physical_damage: ["Calc_Damage_Low"], high_physical_damage: ["Calc_Damage_High", "Calc_Damage_Low"] });

// 安蓓萨：E
put("ambessa_e", [
  fixed("slow_duration_ms", "血戮减速持续时间（毫秒）", "INTEGER", ms(at("ambessa_e", "Slow_Duration")), "当前Slow_Duration=1秒，转换为1000毫秒。", 10),
  fixed("slow_ratio", "血戮减速比例", "DECIMAL", at("ambessa_e", "Slow_Amount"), "当前正文以Slow_Amount×100显示99%减速；保留0.99比例。", 20),
  skillLevels("base_damage", "血戮单一敌人基础物理伤害", "INTEGER", levels("ambessa_e", "Damage_Flat_Base", 5), "当前Damage_Flat_Base技能等级1至5为40/60/80/100/120。", 30),
  fixed("bonus_ad_ratio", "血戮额外攻击力比例", "DECIMAL", at("ambessa_e", "ADRatio"), "当前Calc_Damage_Flat的mStat=2、mStatFormula=2，系数0.5为来源额外攻击力。", 40),
], [
  formula("physical_damage", "血戮单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前Calc_Damage_Flat=Damage_Flat_Base+0.5×来源额外攻击力。", 10),
], [], [
  { item: "减速衰减曲线", reason: "保留99%和1秒窗口；当前树没有中间衰减函数，不作线性展开。" },
], [
  { item: "第二段龙犬诡步额外打击", reason: "正文明确第一段龙犬诡步会触发额外打击；触发时序待接，主伤害公式不重复创建。" },
], "安蓓萨E只保存当前Calc_Damage_Flat的单一敌人伤害和减速来源值；第二段触发及减速衰减留待事件层。", { physical_damage: ["Calc_Damage_Flat"] });

// 安蓓萨：R
put("ambessa_r", [
  skillLevels("base_damage", "公开处刑单一敌人基础物理伤害", "INTEGER", levels("ambessa_r", "Damage", 3), "当前Damage技能等级1至3为150/250/350；索引0为旧占位50。", 10),
  fixed("bonus_ad_ratio", "公开处刑额外攻击力比例", "DECIMAL", at("ambessa_r", "ADRatio"), "当前Calc_Damage的mStat=2、mStatFormula=2，系数0.8为来源额外攻击力。", 20),
  fixed("suppress_duration_ms", "公开处刑压制持续时间（毫秒）", "INTEGER", ms(at("ambessa_r", "Suppress_Duration")), "当前Suppress_Duration=0.75秒，转换为750毫秒。", 30),
  fixed("stun_duration_ms", "公开处刑晕眩持续时间（毫秒）", "INTEGER", ms(at("ambessa_r", "Stun_Duration")), "当前Stun_Duration=0.4秒，转换为400毫秒。", 40),
  skillLevels("armor_penetration_ratio", "公开处刑百分比护甲穿透", "DECIMAL", levels("ambessa_r", "Armor_Penetration", 3), "当前Armor_Penetration技能等级1至3为10%/20%/30%，按比例保存。", 50),
  skillLevels("omnivamp_base_ratio", "公开处刑基础全能吸血比例", "DECIMAL", levels("ambessa_r", "Omnivamp", 3), "当前Calc_Omnivamp基础值为15%/17.5%/20%，按比例保存。", 60),
  fixed("omnivamp_unknown_stat_ratio", "公开处刑未知属性18系数", "DECIMAL", at("ambessa_r", "Omnivamp_LifeStealScaling"), "当前Calc_Omnivamp第二项为mStat18×0.5；mStat18枚举未窄证，保留系数但不映射生命偷取。", 70),
  runtime("omnivamp_unknown_stat_value", "公开处刑mStat18实际输入", "DECIMAL", "当前Calc_Omnivamp的mStat18属性枚举未证；运行层提供实际值，无默认，禁止把它默认成生命偷取或法强。", 80),
], [
  formula("physical_damage", "公开处刑单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前Calc_Damage=Damage+0.8×来源额外攻击力。", 10),
  formula("omnivamp_ratio", "公开处刑自身回复比例", add(P("omnivamp_base_ratio"), mul(P("omnivamp_unknown_stat_ratio"), P("omnivamp_unknown_stat_value"))), "当前Calc_Omnivamp=Omnivamp+0.5×mStat18；属性枚举保持运行输入，不默认成生命偷取。", 20),
], [], [
  { item: "小兵/野怪治疗效能", reason: "Omnivamp_MinionMod与Omnivamp_MonsterMod是兵野专用分支，本轮排除。" },
], [
  { item: "最远敌方英雄选择、压制/晕眩和自身回复事件", reason: "保留伤害、护甲穿透、回复比例及控制时长；目标选择和事件时序待接。" },
], "安蓓萨R保留单一敌人伤害和自身被动收益；mStat18只作为无默认运行输入，未把来源命名LifeStealScaling擅自映射成属性。", { physical_damage: ["Calc_Damage"], omnivamp_ratio: ["Calc_Omnivamp"] });

// 阿萝拉：P
put("aurora_p", [
  fixed("max_hit_count", "驱灵奇术单一敌人触发所需命中次数", "INTEGER", 3, "当前正文明确对一个敌人造成3次伤害后驱灵；命中事件由事件层接线。", 5),
  fixed("spirit_mode_duration_ms", "驱灵奇术灵物跟随持续时间（毫秒）", "INTEGER", ms(at("aurora_p", "SpiritModeDuration")), "当前英雄目标灵物跟随4秒，转换为4000毫秒。", 10),
  fixed("max_health_damage_base_ratio", "驱灵奇术最大生命基础伤害比例", "DECIMAL", at("aurora_p", "BaseHPDamage"), "当前ProcDamage按最大生命值显示，基础比例为1%。", 20),
  fixed("max_health_damage_ap_ratio", "驱灵奇术最大生命法强伤害比例", "DECIMAL", coefficient("aurora_p", "ProcDamage", 1), "当前ProcDamage第二项无mStat、系数0.00027，按同版窄证读取来源法强；正文按百分比显示。", 30),
  fixed("spirit_heal_base_min", "驱灵奇术灵物治疗角色等级下限", "INTEGER", calcPart("aurora_p", "HealCalc").mStartValue, "当前HealCalc角色等级插值下限3。", 40),
  fixed("spirit_heal_base_max", "驱灵奇术灵物治疗角色等级上限", "INTEGER", calcPart("aurora_p", "HealCalc").mEndValue, "当前HealCalc角色等级插值上限20。", 50),
  runtime("spirit_heal_base_at_character_level", "驱灵奇术灵物治疗角色等级基础值", "DECIMAL", "当前HealCalc角色等级中间插值未证；运行层提供实际值，无默认。", 60),
  fixed("spirit_heal_ap_ratio", "驱灵奇术灵物治疗法强比例", "DECIMAL", coefficient("aurora_p", "HealCalc", 1), "当前HealCalc第二项系数0.02×来源法强。", 70),
], [
  formula("proc_damage_ratio", "驱灵奇术单一敌人最大生命伤害比例", add(P("max_health_damage_base_ratio"), mul(P("max_health_damage_ap_ratio"), AP())), "当前ProcDamage=1%+0.00027×来源法强，结果乘目标最大生命；目标资格和三次命中由事件层提供。", 10),
  formula("spirit_heal_value", "驱灵奇术灵物每秒自身治疗", add(P("spirit_heal_base_at_character_level"), mul(P("spirit_heal_ap_ratio"), AP())), "当前HealCalc=角色等级基础值+0.02×来源法强；正文说明英雄目标灵物每秒治疗。", 20),
], [], [
  { item: "野怪最大生命伤害封顶", reason: "当前正文明确野怪封顶且封顶树含角色等级和MonsterMaxDamage，属于兵野专用分支。" },
  { item: "MoveSpeedCalc、BonusMSCalc和CooldownDuration", reason: "当前被动正文未消费这些移动速度或冷却树，不建立无消费者中转公式。" },
], [
  { item: "三次命中、英雄目标灵物资格和治疗周期", reason: "保留伤害比例、4秒跟随和治疗公式；三次命中、英雄资格与每秒执行事件待接。" },
], "阿萝拉P保留当前ProcDamage与HealCalc消费的最大生命伤害比例和灵物治疗；野怪封顶及未消费移动/冷却树排除。", { proc_damage_ratio: ["ProcDamage"], spirit_heal_value: ["HealCalc"] });

// 阿萝拉：Q
put("aurora_q", [
  skillLevels("base_damage", "飞去来咒首次基础魔法伤害", "INTEGER", levels("aurora_q", "BaseDamage", 5), "当前BaseDamage技能等级1至5为45/70/95/120/145；索引0为旧占位20。", 10),
  fixed("ap_ratio", "飞去来咒首次法术强度比例", "DECIMAL", coefficient("aurora_q", "Damage", 1), "当前Damage第二项为0.4×来源法强。", 20),
  skillLevels("q2_base_damage", "飞去来咒再次施放基础魔法伤害", "INTEGER", levels("aurora_q", "Q2BaseDamage", 5), "当前Q2BaseDamage技能等级1至5为45/70/95/120/145；单独保留源字段。", 30),
  fixed("q2_ap_ratio", "飞去来咒再次施放法术强度比例", "DECIMAL", coefficient("aurora_q", "Q2DamageMax", 1), "当前Q2DamageMax基础树第二项为0.4×来源法强。", 40),
  fixed("q2_multiplier", "飞去来咒再次施放最高伤害倍率", "DECIMAL", calc("aurora_q", "Q2DamageMax").mMultiplier.mNumber, "当前Q2DamageMax倍率树为1.5。", 50),
  fixed("additional_hit_damage_ratio", "飞去来咒后续命中伤害比例", "DECIMAL", at("aurora_q", "DamageReduction"), "当前正文明确第一次命中后的伤害降低至20%，DataValues.DamageReduction=0.2；后续命中归属与命中顺序待核，不把正文短语直接解释为额外目标。", 55),
  fixed("mark_duration_ms", "飞去来咒诅咒持续时间（毫秒）", "INTEGER", ms(at("aurora_q", "MarkDuration")), "当前MarkDuration=3.5秒，转换为3500毫秒。", 60),
], [
  formula("first_magic_damage", "飞去来咒首次单一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), AP())), "当前Damage=BaseDamage+0.4×来源法强。", 10),
  formula("q2_base_magic_damage", "飞去来咒再次施放基础魔法伤害", add(P("q2_base_damage"), mul(P("q2_ap_ratio"), AP())), "当前Q2DamageMax基础树=Q2BaseDamage+0.4×来源法强；已损生命最高倍率另行计算。", 20),
  formula("q2_max_magic_damage", "飞去来咒再次施放最高魔法伤害", mul(add(P("q2_base_damage"), mul(P("q2_ap_ratio"), AP())), P("q2_multiplier")), "当前Q2DamageMax=1.5×(Q2BaseDamage+0.4×来源法强)，只表达正文最高值。", 30),
], [], [
  { item: "小兵/野怪再次施放倍率", reason: "Q2MinionMod是兵野专用分支，本轮排除。" },
], [
  { item: "后续命中归属、命中顺序、已损生命中间曲线和自动再次施放", reason: "保留正文明确的20%后续命中比例和Q2最高值；当前短文本不足以判定额外目标、适用命中顺序或中间曲线，相关事件待接。" },
  { item: "诅咒标记消费", reason: "保留3.5秒标记和首次/再次施放公式，标记消费事件待接。" },
], "阿萝拉Q分开记录首次伤害、再次施放基础树、1.5倍最高值和正文明确的20%后续命中比例；不把短文本直接解释为额外目标，也不把Q2最高值误当完整已损生命曲线。", { first_magic_damage: ["Damage"], q2_base_magic_damage: ["Q2DamageMax"], q2_max_magic_damage: ["Q2DamageMax"] });

// 阿萝拉：W
put("aurora_w", [
  skillLevels("invis_duration_ms", "灵纱洞开隐形持续时间（毫秒）", "INTEGER", levels("aurora_w", "InvisDuration", 5, ms), "当前InvisDuration技能等级1至5为1/1.15/1.3/1.45/1.6秒，转换为1000/1150/1300/1450/1600毫秒。", 10),
  skillLevels("move_speed_bonus_ratio", "灵纱洞开移动速度加成比例", "DECIMAL", levels("aurora_w", "MoveSpeedBonus", 5, (value) => clean(value / 100)), "当前MoveSpeedBonus技能等级1至5的原始值为20/25/30/35/40百分数点；正文直接接%后换算为0.2/0.25/0.3/0.35/0.4比例。", 20),
  fixed("dash_bonus_speed", "灵纱洞开跳跃额外速度", "INTEGER", at("aurora_w", "DashBonusSpeed"), "当前DashBonusSpeed=350；只保存位移来源值。", 30),
  fixed("jump_distance", "灵纱洞开跳跃距离", "INTEGER", at("aurora_w", "JumpDistance"), "当前JumpDistance=300；位移资格保留，不创建过程。", 40),
  fixed("wall_cheat_distance", "灵纱洞开墙体修正距离", "INTEGER", at("aurora_w", "WallCheatDistance"), "当前WallCheatDistance=450；空间几何只保存来源值。", 50),
], [], [], [
  { item: "双界行者状态的独立状态对象", reason: "当前正文明确自身状态和位移，但本轮不造未定义状态类型；保留时长、移动速度和空间来源值。" },
], [
  { item: "落地、隐形、移动速度和击杀重置事件", reason: "技能不是完整换套技能；事件顺序、状态应用和击杀重置待接。" },
], "阿萝拉W按本体状态保留隐形、移动速度和位移相关明确数值；不因外观或双界行者名称排除本体行为，也不造无消费者状态。", {});

// 阿萝拉：E
put("aurora_e", [
  skillLevels("base_damage", "怪奇喷涌基础魔法伤害", "INTEGER", levels("aurora_e", "BaseDamage", 5), "当前BaseDamage技能等级1至5为70/110/150/190/230；索引0为旧占位30。", 10),
  fixed("ap_ratio", "怪奇喷涌法术强度比例", "DECIMAL", coefficient("aurora_e", "DamageCalc", 1), "当前DamageCalc第二项系数0.7×来源法强。", 20),
  fixed("slow_ratio", "怪奇喷涌减速比例", "DECIMAL", Math.abs(at("aurora_e", "SlowPercent")), "当前SlowPercent原值为-0.8，正文以SlowPercent×-100显示80%减速；保存正的0.8幅度。", 30),
  fixed("slow_decay_ratio", "怪奇喷涌减速衰减比例", "DECIMAL", at("aurora_e", "SlowDecay"), "当前SlowDecay=0.85；只保存衰减终点参数，不编中间曲线。", 40),
  fixed("slow_duration_ms", "怪奇喷涌减速持续时间（毫秒）", "INTEGER", ms(at("aurora_e", "SlowDuration")), "当前SlowDuration=1秒，转换为1000毫秒。", 50),
  fixed("self_knockback_distance", "怪奇喷涌自身后跳距离", "INTEGER", at("aurora_e", "SelfKnockBackDistance"), "当前SelfKnockBackDistance=250；自身位移资格保留。", 60),
], [
  formula("magic_damage", "怪奇喷涌单一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), AP())), "当前DamageCalc=BaseDamage+0.7×来源法强。", 10),
], [], [
  { item: "减速中间衰减函数", reason: "当前只给80%起点、0.85衰减参数和1秒时长，未给中间求值函数，不线性展开。" },
  { item: "区域长度/宽度等纯几何显示", reason: "本轮只保留单一敌人伤害、减速和自身后跳来源值。" },
], [
  { item: "灵魂洪流命中、减速衰减和后跳时序", reason: "公式和来源时长已保存；命中、控制和后跳事件待接。" },
], "阿萝拉E保留当前DamageCalc实际伤害树与负号修正后的80%减速幅度；不把字段名或几何换算当新公式。", { magic_damage: ["DamageCalc"] });

// 阿萝拉：R
put("aurora_r", [
  skillLevels("base_damage", "双界合一冲击波基础魔法伤害", "INTEGER", levels("aurora_r", "BaseDamage", 3), "当前BaseDamage技能等级1至3为175/275/375；索引0为旧占位75。", 10),
  fixed("ap_ratio", "双界合一法术强度比例", "DECIMAL", coefficient("aurora_r", "DamageCalc", 1), "当前DamageCalc第二项系数0.7×来源法强。", 20),
  fixed("impact_slow_ratio", "双界合一落地减速比例", "DECIMAL", Math.abs(at("aurora_r", "SlowPercent")), "当前SlowPercent原值-0.3，正文以负号转为30%减速；保存正的0.3幅度。", 30),
  fixed("impact_slow_duration_ms", "双界合一落地减速持续时间（毫秒）", "INTEGER", 2000, "当前正文明确落地减速持续2秒，转换为2000毫秒。", 40),
  skillLevels("area_duration_ms", "双界合一交界领域持续时间（毫秒）", "INTEGER", levels("aurora_r", "AreaDuration", 3, ms), "当前AreaDuration技能等级1至3为2.5/3.25/4秒，转换为2500/3250/4000毫秒。", 50),
  skillLevels("realm_hopper_duration_ms", "双界合一自身双界行者持续时间（毫秒）", "INTEGER", levels("aurora_r", "RBuffDuration", 3, ms), "当前RBuffDuration技能等级1至3为3.5/4.25/5秒，转换为3500/4250/5000毫秒。", 60),
  fixed("area_size", "双界合一交界领域尺寸", "INTEGER", at("aurora_r", "AoESize"), "当前AoESize=700；只保存区域来源值，不创建额外目标过程。", 70),
  fixed("exit_slow_ratio", "双界合一进出区域减速比例", "DECIMAL", Math.abs(at("aurora_r", "ExitSlowPercent")), "当前ExitSlowPercent原值-0.5，正文以负号转为50%减速；保存正幅度。", 80),
  skillLevels("exit_slow_duration_ms", "双界合一进出区域减速持续时间（毫秒）", "INTEGER", levels("aurora_r", "StunDuration", 3, ms), "当前字段名StunDuration但正文明确是进出区域减速，技能等级1至3为1.25/1.5/1.75秒，转换为毫秒；不称晕眩。", 90),
], [
  formula("magic_damage", "双界合一单一敌人冲击波魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), AP())), "当前DamageCalc=BaseDamage+0.7×来源法强；只表达冲击波单一敌人伤害。", 10),
], [], [
  { item: "ExitBaseDamage和MSMultiplier", reason: "当前绑定正文未消费这两个字段；不建立无消费者伤害或移速公式。" },
  { item: "区域额外敌人反复命中", reason: "本轮只保留唯一敌人冲击波和自身领域时间，进出区域额外目标分支不展开。" },
], [
  { item: "落地、领域边界减速、传送和再次施放", reason: "保留2秒落地减速、领域/自身状态时长及进出区域减速；事件时序和传送资格待接。" },
], "阿萝拉R区分冲击波伤害、落地2秒减速、领域持续和自身双界行者持续；字段名StunDuration按正文记为减速，不误写晕眩。", { magic_damage: ["DamageCalc"] });

// 贝蕾亚：P
put("briar_p", [
  fixed("bleed_duration_seconds", "猩红诅咒流血总时长（秒）", "DECIMAL", at("briar_p", "BleedDuration"), "当前BleedDamageOverDurationTooltip直接乘BleedDuration=5秒；保留源秒数供总量公式使用。", 10),
  fixed("bleed_duration_ms", "猩红诅咒流血总时长（毫秒）", "INTEGER", ms(at("briar_p", "BleedDuration")), "当前BleedDuration=5秒，转换为5000毫秒；与秒口径分开，避免总量公式乘毫秒。", 20),
  fixed("bleed_tick_interval_ms", "猩红诅咒流血节拍（毫秒）", "INTEGER", ms(at("briar_p", "BleedTickRate")), "当前BleedTickRate=0.5秒，转换为500毫秒；不创建周期过程。", 30),
  fixed("pre_mitigation_heal_ratio", "猩红诅咒折前伤害治疗比例", "DECIMAL", at("briar_p", "HealPercent"), "当前正文明确按流血折前伤害的25%治疗；与W已造成伤害治疗分开。", 40),
  fixed("bleed_base_damage_min", "猩红诅咒每秒流血角色等级下限", "INTEGER", calcPart("briar_p", "{15da76ad}").mStartValue, "当前{15da76ad}角色等级插值下限2。", 50),
  fixed("bleed_base_damage_max", "猩红诅咒每秒流血角色等级上限", "INTEGER", calcPart("briar_p", "{15da76ad}").mEndValue, "当前{15da76ad}角色等级插值上限10。", 60),
  runtime("bleed_base_damage_at_character_level", "猩红诅咒角色等级流血基础值", "DECIMAL", "当前{15da76ad}角色等级中间插值未证；运行层提供每秒基础值，无默认。", 70),
  fixed("bleed_bonus_ad_ratio", "猩红诅咒流血额外攻击力比例", "DECIMAL", coefficient("briar_p", "{15da76ad}", 1), "当前{15da76ad}第二项mStat=2、mStatFormula=2、系数0.1，读取来源额外攻击力。", 80),
  fixed("bleed_full_stack_multiplier", "猩红诅咒满层流血倍率", "DECIMAL", calc("briar_p", "BleedMaxDamageOverDurationTooltip").mMultiplier.mPart2.mNumber, "当前BleedMaxDamageOverDurationTooltip在总量上乘2；不使用未消费BleedPercentAdd编叠层公式。", 90),
  fixed("max_bleed_stack_count", "猩红诅咒最大流血层数", "INTEGER", at("briar_p", "MaxBleedStacks"), "当前最多5层。", 100),
  fixed("missing_health_heal_base_ratio", "猩红诅咒已损生命治疗提升基础比例", "DECIMAL", at("briar_p", "HealShieldPerMissingHPPercent"), "当前{b38f3487}基础项0.4，最终显示树乘100为40%；只保留上限口径。", 110),
  fixed("missing_health_heal_stat_ratio", "猩红诅咒已损生命治疗提升mStat12系数", "DECIMAL", coefficient("briar_p", "{b38f3487}", 1), "当前{b38f3487}为mStat12×0.00025；mStat12属性枚举未窄证。", 120),
  runtime("missing_health_heal_stat_value", "猩红诅咒mStat12实际输入", "DECIMAL", "当前已损生命治疗上限树使用mStat12，属性枚举未窄证；运行层提供实际值，无默认。", 130),
  fixed("current_health_cost_ratio", "猩红诅咒技能当前生命消耗比例", "DECIMAL", at("briar_p", "CurrentHealthPercentCost"), "当前正文明确技能消耗5%当前生命值；不自动创建资源扣除。", 140),
  fixed("bleed_kill_heal_remaining_ratio", "猩红诅咒击杀剩余流血治疗比例", "DECIMAL", at("briar_p", "PercentOfBleedHealedOnKill"), "当前正文明确击杀流血目标时按剩余流血伤害的125%治疗；事件待接。", 150),
], [
  formula("bleed_damage_per_second", "猩红诅咒每秒流血伤害基础量", add(P("bleed_base_damage_at_character_level"), mul(P("bleed_bonus_ad_ratio"), AD_BONUS())), "当前{15da76ad}=角色等级基础值+0.1×来源额外攻击力；中间等级基础值运行提供。", 10),
  formula("bleed_total_damage", "猩红诅咒单层总流血伤害", mul(add(P("bleed_base_damage_at_character_level"), mul(P("bleed_bonus_ad_ratio"), AD_BONUS())), P("bleed_duration_seconds")), "当前BleedDamageOverDurationTooltip={15da76ad}×BleedDuration；以秒为单位，保持tooltipOnly实际消费口径。", 20),
  formula("bleed_max_total_damage", "猩红诅咒满层总流血伤害", mul(mul(add(P("bleed_base_damage_at_character_level"), mul(P("bleed_bonus_ad_ratio"), AD_BONUS())), P("bleed_duration_seconds")), P("bleed_full_stack_multiplier")), "当前BleedMaxDamageOverDurationTooltip=BleedDamageOverDurationTooltip×2；不将BleedPercentAdd误作逐层加成。", 30),
  formula("missing_health_heal_percent", "猩红诅咒已损生命治疗提升百分数", mul(P("missing_health_heal_display_multiplier"), add(P("missing_health_heal_base_ratio"), mul(P("missing_health_heal_stat_ratio"), P("missing_health_heal_stat_value")))), "当前TotalHealPerMissingHPPercentTooltip=100×(0.4+0.00025×mStat12)，结果按百分数显示。", 40),
], [], [
  { item: "BleedPercentAdd", reason: "当前正文消费的满层树直接乘2，BleedPercentAdd未进入当前可见树；不凭字段名造叠层公式。" },
  { item: "流血周期伤害和直接治疗结果", reason: "只保存总量树、治疗比例和节拍参数，不创建DAMAGE、DIRECT_HEAL或周期过程。" },
], [
  { item: "已损生命中间曲线、流血应用/叠层/击杀事件和技能当前生命扣除", reason: "保留上限和源比例；中间函数、事件时序、资源扣除待接。" },
], "贝蕾亚P保留当前消费的tooltipOnly流血总量树和折前治疗比例；已损生命上限用无默认mStat12输入，和W已造成伤害治疗严格分开。", {
  bleed_damage_per_second: ["{15da76ad}"],
  bleed_total_damage: ["BleedDamageOverDurationTooltip", "{15da76ad}"],
  bleed_max_total_damage: ["BleedMaxDamageOverDurationTooltip", "BleedDamageOverDurationTooltip"],
  missing_health_heal_percent: ["TotalHealPerMissingHPPercentTooltip", "{b38f3487}"],
});
// 生成P的显示倍率参数，保持简单值直接引用，不引入多余公式。
writes.briar_p.parameters.push(fixed("missing_health_heal_display_multiplier", "猩红诅咒已损生命治疗显示倍率", "INTEGER", calc("briar_p", "TotalHealPerMissingHPPercentTooltip").mMultiplier.mNumber, "当前TotalHealPerMissingHPPercentTooltip外层Number=100；只作显示口径倍率。", 160));

// 贝蕾亚：Q
put("briar_q", [
  skillLevels("base_damage", "冲头基础物理伤害", "INTEGER", levels("briar_q", "BaseDamage", 5), "当前BaseDamage技能等级1至5为60/85/110/135/160；索引0为旧占位35。", 10),
  fixed("ap_ratio", "冲头法术强度比例", "DECIMAL", coefficient("briar_q", "TotalDamage", 1), "当前TotalDamage第二项无mStat、系数0.6，按同版窄证读取来源法强。", 20),
  fixed("bonus_ad_ratio", "冲头额外攻击力比例", "DECIMAL", coefficient("briar_q", "TotalDamage", 2), "当前TotalDamage第三项mStat=2、mStatFormula=2、系数0.8，读取来源额外攻击力。", 30),
  fixed("stun_duration_ms", "冲头晕眩持续时间（毫秒）", "INTEGER", ms(at("briar_q", "StunDuration")), "当前StunDuration=0.85秒，转换为850毫秒。", 40),
  skillLevels("shred_ratio", "冲头护甲魔抗削减比例", "DECIMAL", levels("briar_q", "ShredPercent", 5), "当前ShredPercent技能等级1至5为10%/12.5%/15%/17.5%/20%，按比例保存。", 50),
  fixed("shred_duration_ms", "冲头护甲魔抗削减持续时间（毫秒）", "INTEGER", ms(at("briar_q", "ShredDuration")), "当前ShredDuration=5秒，转换为5000毫秒。", 60),
], [
  formula("physical_damage", "冲头单一敌人物理伤害", add(add(P("base_damage"), mul(P("ap_ratio"), AP())), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前TotalDamage=BaseDamage+0.6×来源法强+0.8×来源额外攻击力。", 10),
], [], [
  { item: "冲头当前生命消耗", reason: "消耗来自跨技能BriarP.CurrentHealthPercentCost；本轮不在Q重复建参数或资源结果。" },
  { item: "小兵/野怪优先目标规则", reason: "属于目标优先级与兵野事件分支，不改变唯一敌人伤害公式。" },
], [
  { item: "跃向目标、晕眩、护甲/魔抗削减和P流血附加", reason: "控制与削减数值保留；施放事件、P叠层和资源扣除待接。" },
], "贝蕾亚Q使用法强与额外攻击力分离的TotalDamage树；P的当前生命消耗保持跨技能来源，不复制为Q本地参数。", { physical_damage: ["TotalDamage"] });

// 贝蕾亚：W
put("briar_w", [
  fixed("berserk_duration_ms", "血莽持续时间（毫秒）", "INTEGER", ms(at("briar_w", "BerserkDuration")), "当前BerserkDuration=5秒，转换为5000毫秒。", 10),
  skillLevels("berserk_attack_speed_ratio", "血莽攻击速度加成比例", "DECIMAL", levels("briar_w", "BerserkAS", 5), "当前BerserkAS技能等级1至5为55%/65%/75%/85%/95%，按比例保存。", 20),
  skillLevels("berserk_move_speed_ratio", "血莽移动速度加成比例", "DECIMAL", levels("briar_w", "BerserkMS", 5), "当前BerserkMS技能等级1至5为24%/33%/42%/51%/60%，按比例保存。", 30),
  skillLevels("empowered_attack_base_damage", "噬击基础额外物理伤害", "INTEGER", levels("briar_w", "AttackBonusDamage", 5), "当前AttackBonusDamage技能等级1至5为5/20/35/50/65；索引0为旧占位-10。", 40),
  fixed("empowered_attack_total_ad_ratio", "噬击总攻击力比例", "DECIMAL", coefficient("briar_w", "TotalAttackBonusDamage", 1), "当前TotalAttackBonusDamage的mStat=2且未给formula，按同版窄证读取来源总攻击力。", 50),
  fixed("empowered_attack_missing_health_base_percent_points", "噬击目标已损生命基础百分数点", "INTEGER", at("briar_w", "AttackPercentMissingHealth"), "当前正文将AttackPercentMissingHealth直接接百分号，9是百分数点，不是0.09比例。", 60),
  fixed("empowered_attack_missing_health_bonus_ad_percent", "噬击目标已损生命额外攻击力百分数系数", "DECIMAL", coefficient("briar_w", "TotalAttackPercentMissingHealth", 1), "当前TotalAttackPercentMissingHealth第二项mStat=2、mStatFormula=2、系数0.025，结果继续按百分数点显示。", 70),
  fixed("attack_heal_stat12_ratio", "噬击治疗来源总生命比例", "DECIMAL", coefficient("briar_w", "AttackMaxHPHeal", 0), "当前AttackMaxHPHeal为无选择器mStat12×0.05；按主负责人同版窄证读取SOURCE.hp.TOTAL。", 100),
  skillLevels("attack_heal_damage_ratio", "噬击已造成伤害治疗比例", "DECIMAL", levels("briar_w", "AttackHealPercent", 5), "当前AttackHealPercent技能等级1至5为24%/28%/32%/36%/40%，按比例保存。", 110),
], [
  formula("empowered_attack_flat_damage", "噬击单一目标额外物理伤害平坦部分", add(P("empowered_attack_base_damage"), mul(P("empowered_attack_total_ad_ratio"), AD_TOTAL())), "当前TotalAttackBonusDamage=AttackBonusDamage+1.05×来源总攻击力。", 10),
  formula("empowered_attack_missing_health_percent", "噬击目标已损生命百分数", add(P("empowered_attack_missing_health_base_percent_points"), mul(P("empowered_attack_missing_health_bonus_ad_percent"), AD_BONUS())), "当前TotalAttackPercentMissingHealth=9+0.025×来源额外攻击力，输出单位为百分数点并再乘目标已损生命。", 20),
  formula("empowered_attack_heal_base", "噬击治疗平坦部分", mul(P("attack_heal_stat12_ratio"), HP_TOTAL()), "当前AttackMaxHPHeal为mStat12×0.05；按主负责人同版窄证将无选择器mStat12读取为来源总生命，治疗事件另行接线。", 30),
], [
  attributeEffect("blood_frenzy_attack_speed", "血莽自身攻击速度", { kind: "PARAMETER", parameterKey: "berserk_attack_speed_ratio" }, "bonus_attack_speed_percent", "INCREASE", "berserk_duration_ms", "当前血莽正文明确持续期间给自身攻击速度；W不移除或替代R强化血莽。", 40),
  attributeEffect("blood_frenzy_move_speed", "血莽自身移动速度", { kind: "PARAMETER", parameterKey: "berserk_move_speed_ratio" }, "move_speed_percent", "INCREASE", "berserk_duration_ms", "当前血莽正文明确持续期间给自身移动速度；目标选择和自我嘲讽事件待接。", 50),
], [
  { item: "血莽攻击周围额外敌人范围伤害及AoEAttackRadius", reason: "AoEAttackDamagePercent与其范围参数服务额外目标分支，本轮单一敌人只保留噬击主目标公式。" },
  { item: "小兵/野怪伤害提升和封顶", reason: "MonsterAndMinionPercentMod与MaxMonsterDamage是兵野专用分支。" },
  { item: "W对R强化血莽的替换", reason: "当前正文明确W不会移除或替代R强化血莽，保留为关系证据而不创建替换状态。" },
], [
  { item: "血莽施放、再次施放、目标已损生命和治疗事件", reason: "保留自身属性效果和三类数值公式；资源、目标选择、实际伤害/治疗事件待接。" },
], "贝蕾亚W保留本体血莽及噬击主目标组成，平坦部分使用总攻击力，已损生命部分使用额外攻击力；不把AoE或兵野支路混入。", { empowered_attack_flat_damage: ["TotalAttackBonusDamage"], empowered_attack_missing_health_percent: ["TotalAttackPercentMissingHealth"], empowered_attack_heal_base: ["AttackMaxHPHeal"] });

// 贝蕾亚：E
put("briar_e", [
  skillLevels("max_base_damage", "惊吼满蓄基础魔法伤害", "INTEGER", levels("briar_e", "MaxBaseDamage", 5), "当前MaxBaseDamage技能等级1至5为80/115/150/185/220；索引0为旧占位45。", 10),
  skillLevels("wall_hit_base_damage", "惊吼撞墙基础额外魔法伤害", "INTEGER", levels("briar_e", "WallHitBaseDamage", 5), "当前WallHitBaseDamage技能等级1至5为115/150/185/220/255?", 20),
  fixed("max_damage_bonus_ad_ratio", "惊吼满蓄额外攻击力比例", "DECIMAL", coefficient("briar_e", "Damage", 1), "当前Damage的mStat=2、mStatFormula=2、系数1，读取来源额外攻击力。", 30),
  fixed("max_damage_ap_ratio", "惊吼满蓄法术强度比例", "DECIMAL", coefficient("briar_e", "Damage", 2), "当前Damage第三项无mStat、系数1，按同版窄证读取来源法强。", 40),
  fixed("wall_hit_bonus_ad_ratio", "惊吼撞墙额外攻击力比例", "DECIMAL", coefficient("briar_e", "WallHitDamage", 1), "当前WallHitDamage第二项mStat=2、mStatFormula=2、系数2.4，读取来源额外攻击力。", 50),
  fixed("wall_hit_ap_ratio", "惊吼撞墙法术强度比例", "DECIMAL", coefficient("briar_e", "WallHitDamage", 2), "当前WallHitDamage第三项无mStat、系数2.4，按同版窄证读取来源法强。", 60),
  fixed("slow_ratio", "惊吼减速比例", "DECIMAL", at("briar_e", "SlowPercent"), "当前SlowPercent=0.8，正文以×100显示80%减速。", 70),
  fixed("slow_duration_ms", "惊吼减速持续时间（毫秒）", "INTEGER", ms(at("briar_e", "SlowDuration")), "当前SlowDuration=0.5秒，转换为500毫秒。", 80),
  fixed("damage_reduction_percent_points", "惊吼蓄力伤害减免百分数点", "INTEGER", at("briar_e", "DRPercent"), "当前DRPercent=35，正文直接接百分号，保存35百分数点。", 90),
  skillLevels("max_health_heal_ratio", "惊吼蓄力最大生命治疗比例", "DECIMAL", levels("briar_e", "HealHPPercent", 5), "当前HealHPPercent技能等级1至5为10%/11.5%/13%/14.5%/16%，按比例保存。", 100),
  fixed("wall_stun_duration_ms", "惊吼撞墙晕眩持续时间（毫秒）", "INTEGER", ms(at("briar_e", "WallStunDuration")), "当前正文明确完全蓄力撞墙后晕眩1.5秒，转换为1500毫秒；撞墙事件待接。", 110),
  fixed("channel_duration_ms", "惊吼蓄力治疗窗口（毫秒）", "INTEGER", 1000, "当前官方正文明确蓄力时在1秒内持续获得治疗；转换为1000毫秒。", 120),
], [
  formula("max_magic_damage", "惊吼满蓄单一敌人魔法伤害", add(add(P("max_base_damage"), mul(P("max_damage_bonus_ad_ratio"), AD_BONUS())), mul(P("max_damage_ap_ratio"), AP())), "当前Damage=MaxBaseDamage+1.0×来源额外攻击力+1.0×来源法强；蓄力下限和中间曲线不编。", 10),
  formula("wall_hit_magic_damage", "惊吼撞墙单一敌人魔法伤害", add(add(P("wall_hit_base_damage"), mul(P("wall_hit_bonus_ad_ratio"), AD_BONUS())), mul(P("wall_hit_ap_ratio"), AP())), "当前WallHitDamage=WallHitBaseDamage+2.4×来源额外攻击力+2.4×来源法强。", 20),
  formula("max_health_heal_value", "惊吼蓄力最大生命治疗值", mul(HP_TOTAL(), P("max_health_heal_ratio")), "当前PercentMaxHPHeal为mStat12×HealHPPercent；按主负责人同版窄证将无选择器mStat12读取为来源总生命，治疗事件另行接线。", 30),
], [], [
  { item: "蓄力下限和中间伤害曲线", reason: "当前树只提供满蓄Damage/WallHitDamage端点，没有蓄力时间函数。" },
  { item: "击退、撞墙事件和伤害/治疗结果", reason: "保留撞墙晕眩时长参数但不造自动控制或伤害/治疗结果；单一敌人伤害公式保留。" },
], [
  { item: "蓄力、移除血莽、伤害减免和1秒治疗时序", reason: "保留窗口、减伤和治疗数值；开始/释放、目标碰墙与事件接线待接。" },
], "贝蕾亚E分开保存满蓄主伤害、撞墙伤害、撞墙晕眩和蓄力治疗；无选择器mStat12按主负责人同版窄证读取来源总生命，不把蓄力满值冒充完整蓄力曲线。", { max_magic_damage: ["Damage"], wall_hit_magic_damage: ["WallHitDamage"], max_health_heal_value: ["PercentMaxHPHeal"] });

// 修正上面从原数组取到的WallHitBaseDamage实际值说明由源值自动覆盖；保持代码不手写端点。
writes.briar_e.parameters.find((item) => item.parameterKey === "wall_hit_base_damage").description = "当前WallHitBaseDamage取技能等级1至5的原始数组；不把索引0旧占位带入候选。";

// 贝蕾亚：R
put("briar_r", [
  skillLevels("base_damage", "毙除着陆基础魔法伤害", "INTEGER", levels("briar_r", "BaseDamage", 3), "当前BaseDamage技能等级1至3为150/250/350；索引0为旧占位50。", 10),
  fixed("ap_ratio", "毙除法术强度比例", "DECIMAL", coefficient("briar_r", "Damage", 1), "当前Damage第二项无mStat、系数1.3，按同版窄证读取来源法强。", 20),
  fixed("aoe_radius", "毙除猎物着陆范围半径", "INTEGER", at("briar_r", "AoERadius"), "当前正文写着陆时对附近一切造成伤害，AoERadius=575用于包含猎物的着陆范围；额外敌人控制不展开。", 50),
  fixed("min_dash_speed", "毙除最小冲刺速度", "INTEGER", at("briar_r", "MinDashSpeed"), "当前MinDashSpeed=2500；只保存位移来源值。", 60),
  fixed("max_dash_speed", "毙除最大冲刺速度", "INTEGER", at("briar_r", "MaxDashSpeed"), "当前MaxDashSpeed=5000；只保存位移来源值。", 70),
  fixed("ideal_dash_time_ms", "毙除理想冲刺时间（毫秒）", "INTEGER", ms(at("briar_r", "IdealDashTime")), "当前IdealDashTime=0.5秒，转换为500毫秒。", 80),
  skillLevels("lifesteal_ratio", "毙除强化血莽生命偷取比例", "DECIMAL", levels("briar_r", "LifestealPercent", 3), "当前LifestealPercent技能等级1至3为10%/15%/20%，按比例保存。", 90),
  fixed("resist_total_ad_ratio", "毙除强化血莽总攻击力双抗比例", "DECIMAL", at("briar_r", "ResistADRatio"), "当前TotalResists的mStat=2且未给formula，按同版窄证取来源总攻击力。", 100),
  skillLevels("extra_move_speed_ratio", "毙除强化血莽额外移动速度比例", "DECIMAL", levels("briar_r", "ExtraMoveSpeedPercent", 3), "当前ExtraMoveSpeedPercent技能等级1至3为10%/20%/30%，按比例保存。", 110),
], [
  formula("magic_damage", "毙除着陆单一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), AP())), "当前Damage=BaseDamage+1.3×来源法强；周围额外敌人分支不展开。", 10),
  formula("total_resists", "毙除强化血莽自身双抗加成", mul(P("resist_total_ad_ratio"), AD_TOTAL()), "当前TotalResists=0.2×来源总攻击力，护甲与魔抗共用该值。", 20),
], [], [
  { item: "周围非猎物恐惧、真实视野和范围重复命中", reason: "FearDuration/FleeSlowPercent和额外命中属于非猎物/额外敌人分支，均不生成可写参数或结果；AoERadius仅保留正文‘附近的一切’对猎物命中范围的原值。" },
  { item: "HuntDuration作为强化状态持续时间", reason: "当前HuntDuration=25000是追击内部值，正文要求追击至猎物死亡，不能当固定持续时间。" },
], [
  { item: "首个英雄标记、到达猎物、强化血莽和自身属性应用", reason: "保留自身双抗、生命偷取和移动速度来源；目标资格、状态时序和死亡结束待接。" },
], "贝蕾亚R保留本体强化血莽和着陆主目标伤害；不因狂暴或操控改变而排除本体，也不把追击内部HuntDuration当状态时长。", { magic_damage: ["Damage"], total_resists: ["TotalResists"] });

// 保护来源与静态完整性
const skills = {};
for (const skillKey of order) {
  const { hero } = bound(skillKey);
  const sourceSkill = hero.source.skills.find((item) => item.slot === slotOf(skillKey));
  skills[skillKey] = {
    skillKey,
    name: hero.name + "·" + (sourceSkill?.name || slotOf(skillKey)),
    maxLevel: sourceSkill?.officialMaxRank || (slotOf(skillKey) === "P" ? 1 : slotOf(skillKey) === "R" ? 3 : 5),
    source: sourceFor(skillKey),
    write: writes[skillKey],
    protectedExisting: { subject: true, compositionLists: true },
    excluded: excluded[skillKey],
    pending: pending[skillKey],
    proofs: [
      { type: "root-bound-source", path: "输入包/来源绑定与当前文本.json -> " + hero.id + "/" + slotOf(skillKey) },
      { type: "fixed-source-version", client: "16.17", official: "16.17.1", build: sourceVersion.build },
    ],
    proofNote: notes[skillKey],
  };
}
const walk = (dir, output = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, output);
    else output.push(file);
  }
  return output;
};
const sourceManifest = walk(INPUT).sort().map((file) => {
  const relative = path.relative(INPUT, file).split(path.sep).join("/");
  return { path: relative, sha256: fileSha(relative), byteSize: fs.statSync(file).size };
});
const declared = new Map((inputVersion.sourceFiles || []).map((file) => [file.path, file]));
const inputIntegrity = sourceManifest.map((file) => {
  const expected = declared.get(file.path);
  return {
    path: file.path,
    actualSha256: file.sha256,
    actualByteSize: file.byteSize,
    declaredSha256: expected?.sha256 ?? null,
    declaredByteSize: expected?.byteSize ?? null,
    declaredMatch: expected ? expected.sha256 === file.sha256 && expected.byteSize === file.byteSize : null,
  };
});
if (inputIntegrity.some((item) => item.declaredMatch === false)) throw new Error("输入包完整性失败");
const protectedSubjects = order.map((skillKey) => ({ skillKey, subject: snapshot.summary?.[skillKey]?.subject || null, source: "输入包/参考资料/当前20槽保护快照.json" }));
const currentCompositionLists = Object.fromEntries(order.map((skillKey) => [skillKey, snapshot.summary?.[skillKey]?.components || null]));
const protectedObjects = {
  subjects: protectedSubjects,
  currentCompositionLists,
  reusedPublicParameters: reuse,
  protectedReferenceRequests: snapshot.requests || [],
  protectedReferenceRoutes: [...new Set((snapshot.requests || []).map((request) => request.route))],
  protectedReferenceCounts: { GETs: snapshot.GETs, subjects: 20, currentCompositionSkillSlots: 20, currentCompositionLists: 120, reusedPublicParameters: reuse.length, images: 20, characters: 4, characterSkillRelations: 4, dictionaries: 4 },
  scope: "只保护既有20个技能主体、六类组成、24项公共参数、四个角色、角色关系、代表图和四类字典；本批不更新既有对象。",
  snapshotFile: "输入包/参考资料/当前20槽保护快照.json",
  snapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
};
const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const routeByKind = { parameters: "parameters", formulas: "formulas", effects: "effects", processes: "processes", internalStates: "internal-states", triggerRules: "trigger-rules" };
const keyByKind = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" };
const allWrites = order.flatMap((skillKey) => kinds.flatMap((kind) => (writes[skillKey][kind] || []).map((body) => ({ skillKey, kind, body }))));
const requestCounts = Object.fromEntries(kinds.map((kind) => [kind, allWrites.filter((item) => item.kind === kind).length]));
const newTotal = Object.values(requestCounts).reduce((sum, count) => sum + count, 0);
const reusedPublicParameters = reuse.map((item) => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false }));
const meta = {
  generatedAt: new Date().toISOString(),
  batch: BATCH,
  status: "候选已生成，等待主负责人审查；未调用业务接口",
  gameId: "lol",
  apiBase: API_BASE,
  sourceVersion,
  scope: "阿克尚、安蓓萨、阿萝拉、贝蕾亚20个技能槽；只新增当前根绑定正文消费且来源明确的参数、实际二元公式和自身持续属性/护盾效果。既有20个主体、120项六类组成、24项公共参数、角色关系、图片和字典全部保护；第三友方、额外敌人、兵野专用、纯视野和无消费者旧树排除。",
  sourcePolicy: "固定客户端16.17、官方16.17.1和构建16.17.8104348；沿当前根绑定正文与实际消费树。未知等级曲线、属性枚举、目标资格、施法时序和运行输入不猜、不设默认；百分数点与比例按正文和计算树分别保存。",
  inputPackage: "输入包/",
  currentSnapshot: "输入包/参考资料/当前20槽保护快照.json",
  currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  businessWrites: 0,
  apiCalls: 0,
  tokenStored: false,
  candidateFileSha256: null,
};
const candidate = {
  meta,
  skills,
  order,
  reusedPublicParameters,
  reusedExistingParameters: reusedPublicParameters,
  counts: {
    newParameters: requestCounts.parameters,
    newFormulas: requestCounts.formulas,
    newEffects: requestCounts.effects,
    newProcesses: requestCounts.processes,
    newInternalStates: requestCounts.internalStates,
    newTriggerRules: requestCounts.triggerRules,
    newTotal,
    reusedPublicParameters: reuse.length,
    plannedTotalIncludingReused: newTotal + reuse.length,
    protectedCurrentCompositionLists: 120,
  },
  apiWrites: 0,
  sourceFiles: sourceManifest,
  sourceNotes: {
    frozenInput: "输入包由主负责人冻结并按字节复制；源值来自根绑定当前正文和固定客户端/官方资料。",
    publicParameterReuse: "复用清单只表示既有对象保护，不复制到新增请求体；24项公共冷却/消耗参数不重建。",
    selectorPolicy: "mStat2/formula0保留总攻击力，mStat2/formula2按同版窄证保留额外攻击力；mStat0或省略选择器只在有窄证时按法强使用；本版贝蕾亚W/E无选择器mStat12按主负责人同版窄证读取SOURCE.hp.TOTAL，P的mStat12/formula2与安蓓萨R的mStat18仍使用无默认运行输入。",
    scopeBoundary: "阿克尚W的GameModeInteger=1展开后自身移动速度、已损法力回复和离墙宽限保留；安蓓萨能量/位移、阿萝拉本体状态、贝蕾亚本体狂暴均不因名称排除。",
    noBusinessWrites: true,
  },
  protectedObjects,
  revision: "hero37-source-v1-revision2",
};
writeJson("完整候选.json", candidate);
const candidateFileSha256 = sha(fs.readFileSync(path.join(ROOT, "完整候选.json")));
const requests = allWrites.map((item, index) => {
  const stableKey = item.body[keyByKind[item.kind]];
  return { sequence: index + 1, method: "POST", route: "/skills/" + item.skillKey + "/" + routeByKind[item.kind], detailRoute: "/skills/" + item.skillKey + "/" + routeByKind[item.kind] + "/" + stableKey, skillKey: item.skillKey, kind: item.kind, stableKey, status: "仅意图，未调用", body: item.body };
});
const plan = {
  generatedAt: new Date().toISOString(),
  status: "仅写入意图，未调用业务接口；候选等待审查",
  batch: BATCH,
  apiBase: API_BASE,
  sourceVersion,
  candidateFileSha256,
  currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  requestCount: requests.length,
  requestCounts,
  currentTotalComponents: newTotal + reuse.length,
  currentCompositionListsProtected: 120,
  reusedPublicParameters,
  protectedSkills: order,
  protectedCounts: protectedObjects.protectedReferenceCounts,
  requests,
  noApiCalls: true,
};
writeJson("写前请求计划.json", plan);
const planFileSha256 = sha(fs.readFileSync(path.join(ROOT, "写前请求计划.json")));
const sourceValues = {
  generatedAt: new Date().toISOString(),
  batch: BATCH,
  sourceVersion,
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  inputFileManifestSha256: sha(JSON.stringify(sourceManifest)),
  skills: Object.fromEntries(order.map((skillKey) => [skillKey, {
    source: sourceFor(skillKey),
    intendedValues: writes[skillKey].parameters.map((item) => ({ parameterKey: item.parameterKey, name: item.name, valueType: item.valueType, valueMode: item.valueMode, fixedValue: item.fixedValue, levelValues: item.levelValues })),
    formulaSources: writes[skillKey].formulas.map((item) => ({ formulaKey: item.formulaKey, expression: item.expression, sourceCalculationNames: formulaSourceNames[skillKey]?.[item.formulaKey] || [] })),
    excluded: excluded[skillKey],
    pending: pending[skillKey],
  }])),
};
writeJson("源值解析.json", sourceValues);
writeJson("来源哈希汇总.json", { generatedAt: new Date().toISOString(), batch: BATCH, sourceVersion, sourceIndexSha256: inputVersion.sourceIndexSha256, inputFiles: sourceManifest, inputIntegrity, currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"), candidateFileSha256, planFileSha256 });
writeJson("来源与范围.json", {
  batch: BATCH,
  status: "候选阶段，未调用业务接口",
  sourceVersion,
  included: [
    "阿克尚：P额外射击、三次命中伤害/护盾和取消射击移动速度，Q单一敌人伤害与命中英雄自身移动速度，W展开后的自身移动速度/已损法力回复，E逐发伤害，R逐发伤害和最高倍率。",
    "安蓓萨：P位移资格、强化攻击/攻速/攻击距离/能量断点，Q两段单一目标主树与最大生命比例，W自身护盾及低/高伤害，E单一敌人伤害，R单一敌人伤害与自身回复比例。",
    "阿萝拉：P三次命中最大生命伤害与英雄灵物治疗，Q首次/再次施放单一敌人伤害，W本体隐形/移动速度/位移，E单一敌人伤害与减速，R冲击波伤害及领域/自身状态时长。",
    "贝蕾亚：P折前流血总量与已损生命治疗上限，Q单一敌人伤害，W本体血莽与噬击主目标组成，E满蓄/撞墙伤害与蓄力治疗，R着陆伤害与强化血莽自身属性。",
  ],
  excludedOrPending: [
    "第三友方、额外敌人、兵野专用伤害/治疗/封顶、金币/复活、纯视野和无消费者旧计算树排除。",
  "未知等级插值、贝蕾亚P与安蓓萨R的mStat12/mStat18运行属性、目标最大生命最终组合、已损生命中间曲线、施法时序、状态触发、资源扣除和周期事件保持待接；贝蕾亚W/E无选择器mStat12已按同版窄证读取来源总生命。",
  ],
  perSkillExcluded: excluded,
  perSkillPending: pending,
});
writeJson("候选版本.json", { batch: BATCH, revision: candidate.revision, generatedAt: new Date().toISOString(), status: "candidate", candidateFileSha256, planFileSha256, sourceIndexSha256: inputVersion.sourceIndexSha256, currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"), counts: candidate.counts, requestCounts, apiWrites: 0 });
writeJson("冻结候选锁.json", { batch: BATCH, revision: candidate.revision, status: "候选已冻结，等待主负责人审查；未调用业务接口", candidateFileSha256, planFileSha256, sourceIndexSha256: inputVersion.sourceIndexSha256, currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"), requestCount: requests.length, requestCounts, protectedCounts: protectedObjects.protectedReferenceCounts, apiWrites: 0, noApiCalls: true, lockType: "静态哈希锁；不代表业务数据库已写入" });
writeJson("候选交付索引.json", { batch: BATCH, revision: candidate.revision, status: "候选交付，未录入业务数据", files: ["完整候选.json", "写前请求计划.json", "源值解析.json", "来源哈希汇总.json", "来源与范围.json", "候选版本.json", "冻结候选锁.json", "体验报告.md", "独立源值数学.mjs", "独立源值数学报告.json"], candidateFileSha256, planFileSha256, counts: candidate.counts, requestCount: requests.length, apiWrites: 0, protectedCounts: protectedObjects.protectedReferenceCounts });
writeText("README.md", [
  "# 第三十七批候选",
  "",
  "本目录保存阿克尚、安蓓萨、阿萝拉、贝蕾亚20个技能槽的静态候选和冻结输入副本。",
  "",
  "当前状态：候选阶段，未调用业务接口，业务写入数为0。源版本固定为客户端16.17、官方资料16.17.1、构建16.17.8104348。",
  "",
  "已有20个技能主体、120项六类组成、24项公共参数、角色关系、图片和字典由输入快照完整保护；本批只新增当前根绑定正文消费的参数、实际二元公式及明确自身属性/护盾效果。第三友方、额外敌人、兵野专用收益、纯视野和无消费者旧树列在范围说明。",
  "",
  "阿克尚W的GameModeInteger=1已按当前正文展开，保留自身移动速度、已损法力回复和离墙宽限；贝蕾亚P的折前流血治疗与W已造成伤害治疗分开，W不替换R强化血莽。未知角色等级曲线和P/R的mStat12/mStat18运行输入不设默认，W/E无选择器mStat12按来源总生命读取。",
  "",
  "请先阅读完整候选、写前请求计划和独立源值数学报告；本批文件不构成真实数据库、运行时或页面验收证据。",
  "",
].join("\n"));
writeText("体验报告.md", [
  "# 第三十七批体验与缺口",
  "",
  "候选阶段未写入业务数据，体验记录只描述后续页面接入需要核对的行为。",
  "",
  "- 阿克尚：P应区分额外射击、三次命中护盾和取消射击移速；W的自身移动速度与已损法力回复要显示条件，R逐发与已损生命最高值不能误显示为已完成中间曲线。",
  "- 安蓓萨：P的位移缓冲、充能攻击和能量断点应分开；Q两段的基础伤害和目标最大生命比例应分开显示；W护盾、低档/格挡后伤害不可自动选档。",
  "- 阿萝拉：P灵物治疗需要标出英雄目标和每秒事件；Q再次施放的1.5倍是最高值；E减速从负源值转为正幅度，R的StunDuration页面应标为进出区域减速。",
  "- 贝蕾亚：P的折前流血治疗、已损生命上限和技能当前生命消耗需分栏；W应同时展示血莽自身属性和噬击主目标组成，并明确不替换R强化血莽；E满蓄/撞墙两档与蓄力治疗分开。",
  "",
  "待补输入：目标资格、额外目标与兵野分支事件、角色等级插值和断点算法、贝蕾亚P与安蓓萨R的mStat12/mStat18属性枚举、已损生命中间曲线、资源扣除、控制时序及状态结束条件；W/E无选择器mStat12按来源总生命读取。独立数学脚本检查实际候选表达式的双场景、缺输入、整数毫秒、二元节点和源数组。",
  "",
].join("\n"));
const outputFiles = ["完整候选.json", "写前请求计划.json", "源值解析.json", "来源哈希汇总.json", "来源与范围.json", "候选版本.json", "冻结候选锁.json", "候选交付索引.json", "README.md", "体验报告.md"];
const fileManifest = outputFiles.map((file) => ({ path: file, sha256: sha(fs.readFileSync(path.join(ROOT, file))), byteSize: fs.statSync(path.join(ROOT, file)).size }));
writeJson("文件散列.json", { generatedAt: new Date().toISOString(), batch: BATCH, status: "候选静态文件冻结；未调用业务接口", files: fileManifest, candidateFileSha256, planFileSha256, apiWrites: 0, noApiCalls: true });
console.log(JSON.stringify({ candidateFileSha256, planFileSha256, requestCount: requests.length, requestCounts, counts: candidate.counts, protectedCounts: protectedObjects.protectedReferenceCounts }, null, 2));
