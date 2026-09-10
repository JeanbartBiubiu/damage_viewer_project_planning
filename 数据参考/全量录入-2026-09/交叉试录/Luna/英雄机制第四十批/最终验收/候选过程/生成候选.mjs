import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = fs.existsSync(path.join(ROOT, "输入包")) ? path.join(ROOT, "输入包") : path.join(ROOT, "..", "输入包");
const BATCH = "英雄机制第四十批";
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BUILD = "16.17.8104348+branch.releases-16-17.content.release";
const readInput = file => JSON.parse(fs.readFileSync(path.join(INPUT, file), "utf8"));
const writeJson = (file, value) => fs.writeFileSync(path.join(ROOT, file), JSON.stringify(value, null, 2) + "\n", "utf8");
const writeText = (file, value) => fs.writeFileSync(path.join(ROOT, file), value, "utf8");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const fileSha = file => sha(fs.readFileSync(path.join(INPUT, file)));
const clean = value => typeof value === "number" ? Number(value.toFixed(8)) : value;
const milliseconds = seconds => {
  const value = Number(seconds) * 1000;
  if (!Number.isInteger(Math.round(value))) throw new Error("毫秒换算不是整数: " + seconds);
  return Math.round(value);
};

const inputVersion = readInput("输入版本.json");
const binding = readInput("来源绑定与当前文本.json");
const snapshot = readInput("参考资料/当前20槽保护快照.json");
const reuse = readInput("参考资料/公共参数复用清单.json");
const sourceVersion = { clientVersion: "16.17", officialVersion: "16.17.1", build: BUILD };
const order = [
  "senna_p", "senna_q", "senna_w", "senna_e", "senna_r",
  "thresh_p", "thresh_q", "thresh_w", "thresh_e", "thresh_r",
  "pyke_p", "pyke_q", "pyke_w", "pyke_e", "pyke_r",
  "twistedfate_p", "twistedfate_q", "twistedfate_w", "twistedfate_e", "twistedfate_r",
];
const heroIds = { senna: "Senna", thresh: "Thresh", pyke: "Pyke", twistedfate: "TwistedFate" };
const heroesById = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const slotOf = skillKey => skillKey.split("_")[1].toUpperCase();
const heroOf = skillKey => heroIds[skillKey.split("_")[0]];
const bound = skillKey => {
  const hero = heroesById[heroOf(skillKey)];
  const skill = hero?.skills.find(item => item.skillKey === skillKey || item.slot === slotOf(skillKey));
  if (!hero || !skill) throw new Error("缺少来源绑定 " + skillKey);
  return { hero, skill, raw: skill.object.mSpell };
};
const data = (skillKey, name) => {
  const values = bound(skillKey).raw.DataValues?.find(item => item.name === name)?.values;
  if (!values) throw new Error("缺少DataValues " + skillKey + "/" + name);
  return values;
};
const at = (skillKey, name, index = 1) => clean(data(skillKey, name)[index]);
const levels = (skillKey, name, maxLevel, transform = clean) => data(skillKey, name).slice(1, maxLevel + 1).map(transform);
const rawArray = (skillKey, name) => bound(skillKey).raw[name];
const rawAt = (skillKey, name, index = 1) => {
  const value = rawArray(skillKey, name);
  return clean(Array.isArray(value) ? value[index] : index === 0 ? value : undefined);
};
const rawLevels = (skillKey, name, maxLevel, transform = clean) => rawArray(skillKey, name).slice(1, maxLevel + 1).map(transform);
const calc = (skillKey, name) => bound(skillKey).raw.mSpellCalculations?.[name] || null;
const calcPart = (skillKey, name, index = 0) => {
  const part = calc(skillKey, name)?.mFormulaParts?.[index];
  if (!part) throw new Error("缺少计算树节点 " + skillKey + "/" + name + "/" + index);
  return part;
};
const coefficient = (skillKey, name, index = null) => {
  const parts = calc(skillKey, name)?.mFormulaParts || [];
  const part = index === null ? parts.find(item => typeof item?.mCoefficient === "number") : parts[index];
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
  if (slot === "P") return { path: "data." + heroId + ".passive", name: hero.passive?.name || null, description: hero.passive?.description || null, tooltip: hero.passive?.tooltip || null, relevantEnemyTips: hero.enemytips || [] };
  const index = { Q: 0, W: 1, E: 2, R: 3 }[slot];
  const spell = hero.spells?.[index];
  return { path: "data." + heroId + ".spells[" + index + "]", name: spell?.name || null, description: spell?.description || null, tooltip: spell?.tooltip || null };
};
const officialSpell = skillKey => {
  const heroId = heroOf(skillKey);
  const file = readInput("参考资料/官方中文/" + heroId + ".json");
  const hero = file.data?.[heroId] || file[heroId] || file;
  if (slotOf(skillKey) === "P") return null;
  return hero.spells?.[{ Q: 0, W: 1, E: 2, R: 3 }[slotOf(skillKey)]] || null;
};
const officialEffectLevels = (skillKey, effectIndex, maxLevel, transform = clean) => {
  const values = officialSpell(skillKey)?.effect?.[effectIndex];
  if (!Array.isArray(values)) throw new Error("缺少官方Effect数组 " + skillKey + "/" + effectIndex);
  return values.slice(0, maxLevel).map(transform);
};
const sourceFor = skillKey => {
  const { hero, skill, raw } = bound(skillKey);
  const clientFile = sourceFile(hero, "client");
  const officialZhFile = sourceFile(hero, "zh");
  const officialEnFile = sourceFile(hero, "en");
  const field = name => raw[name] === undefined ? null : raw[name];
  return {
    hero: hero.id, heroName: hero.name, heroKey: hero.key, resourceType: hero.source.resourceType,
    rootPath: hero.rootPath || hero.source.rootPath, spellPath: skill.binding, bindingAvailable: true,
    clientFile, clientSha256: hero.source.client.sha256, clientCompressedSha256: hero.source.client.compressedSha256 || fileSha(clientFile),
    clientBuild: hero.source.client.contentVersion || BUILD, officialZhFile, officialZhSha256: fileSha(officialZhFile),
    officialEnFile, officialEnSha256: fileSha(officialEnFile), currentBoundText: skill.currentTexts,
    raw: {
      dataValues: Object.fromEntries((raw.DataValues || []).map(item => [item.name, item.values ? item.values.slice() : null])),
      calculations: raw.mSpellCalculations || {}, spellCastTime: field("spellCastTime"), mCastTime: field("mCastTime"),
      spellTotalTime: field("spellTotalTime"), mChannelDuration: field("mChannelDuration"), cooldownTime: field("cooldownTime"),
      mana: field("mana"), manaValues: field("manaValues"), mMaxAmmo: field("mMaxAmmo"), mAmmoRechargeTime: field("mAmmoRechargeTime"),
      mDoesNotConsumeMana: field("mDoesNotConsumeMana"), mDoesNotConsumeCooldown: field("mDoesNotConsumeCooldown"),
    },
    officialEvidence: officialEvidence(hero.id, slotOf(skillKey)),
    currentTextPath: "输入包/来源绑定与当前文本.json -> " + hero.id + "/" + slotOf(skillKey) + "/currentTexts",
  };
};

const parameter = (parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode, fixedValue: fixedValue ?? null,
  levelValues: levelValues ? Object.fromEntries(levelValues.map((value, index) => [String(index + 1), clean(value)])) : null,
  description, sortOrder,
});
const fixed = (key, name, type, value, description, sortOrder) => parameter(key, name, type, "FIXED", clean(value), null, description, sortOrder);
const skillLevels = (key, name, type, values, description, sortOrder) => parameter(key, name, type, "SKILL_LEVEL", null, values, description, sortOrder);
const runtime = (key, name, type, description, sortOrder) => parameter(key, name, type, "RUNTIME_INPUT", null, null, description, sortOrder);
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const add = (left, right) => O("ADD", left, right);
const mul = (left, right) => O("MULTIPLY", left, right);
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const AD_TOTAL = () => A("SOURCE", "attack_damage", "TOTAL");
const AD_BONUS = () => A("SOURCE", "attack_damage", "BONUS");
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const formulaValue = formulaKey => ({ kind: "FORMULA", formulaKey });
const parameterValue = parameterKey => ({ kind: "PARAMETER", parameterKey });
const valueRule = value => ({ value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const timedLifecycle = durationParameterKey => ({
  durationValue: parameterValue(durationParameterKey), maxStacksValue: { kind: "FIXED", value: 1 },
  applicationStacksValue: { kind: "FIXED", value: 1 }, instanceScope: "SOURCE", reapplicationStackMode: "KEEP",
  reapplicationDurationMode: "REFRESH_ALL", expiryMode: "ALL_AT_ONCE", periodicIntervalValue: null, firstPeriodicExecution: null,
});
const persistentLifecycle = () => ({
  durationValue: null, maxStacksValue: { kind: "FIXED", value: 1 }, applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope: "SOURCE", reapplicationStackMode: "KEEP", reapplicationDurationMode: null, expiryMode: "EXPLICIT_ONLY",
  periodicIntervalValue: null, firstPeriodicExecution: null,
});
const persistentBehavior = () => ({ moment: "PERSISTENT", valueReadMode: "APPLICATION_SNAPSHOT", stackValueMode: "SHARED", reapplicationValueMode: "REPLACE", periodicExecutionMode: null });
const resourceEffect = (effectKey, name, value, operation, description, sortOrder = 10) => ({
  effectKey, name, description, sortOrder, lifecycle: null,
  results: [{ resultKey: "resource", name, resultType: "RESOURCE_CHANGE", target: "SOURCE", description: null, sortOrder: 10,
    lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule(value), detail: { attributeKey: "mana", operation } }],
});
const manaCostEffect = (skillKey, description = "只引用当前快照中已存在的基础法力参数；扣除时点与施放资格由后续事件层接线。") =>
  resourceEffect("mana_cost", "施放法力消耗", parameterValue("mana_cost"), "CONSUME", skillKey + "：" + description);
const manaRestoreEffect = (parameterKey, name, description) =>
  resourceEffect("mana_restore", name, parameterValue(parameterKey), "RESTORE", description);
const manaRefundEffect = (formulaKey, name, description) =>
  resourceEffect("mana_refund", name, formulaValue(formulaKey), "REFUND", description);
const attributeEffect = (effectKey, name, value, attributeKey, lifecycle, description, sortOrder = 20) => ({
  effectKey, name, description, sortOrder, lifecycle,
  results: [{ resultKey: "attribute", name, resultType: "ATTRIBUTE_CHANGE", target: "SOURCE",
    description: "只定义来源明确的自身属性变化；触发事件由后续事件层接线。", sortOrder: 10, lifecycleBehavior: persistentBehavior(),
    spellShieldBlockScope: null, valueRule: valueRule(value), detail: { attributeKey, operation: "INCREASE", modifierZoneKey: "attribute_flat_add" } }],
});
const normalShieldEffect = (effectKey, name, formulaKey, durationKey, description, sortOrder = 20) => ({
  effectKey, name, description, sortOrder, lifecycle: timedLifecycle(durationKey),
  results: [{ resultKey: "shield", name, resultType: "NORMAL_SHIELD", target: "SOURCE",
    description: "只定义来源明确的自身普通护盾数值；触发和移除事件由后续事件层接线。", sortOrder: 10,
    lifecycleBehavior: persistentBehavior(), spellShieldBlockScope: null, valueRule: valueRule(formulaValue(formulaKey)),
    detail: { absorbedDamageTypeKey: null, decayMode: "NONE" } }],
});
const writes = {}, excluded = {}, pending = {}, notes = {}, formulaSourceNames = {};
const put = (skillKey, parameters, formulas, effects, excludedItems, pendingItems, proofNote, sourceNames = {}) => {
  writes[skillKey] = { parameters, formulas, effects, processes: [], internalStates: [], triggerRules: [] };
  excluded[skillKey] = excludedItems; pending[skillKey] = pendingItems; notes[skillKey] = proofNote; formulaSourceNames[skillKey] = sourceNames;
};

// 赛娜P
put("senna_p", [
  fixed("ad_per_soul", "每层黑雾攻击力", "DECIMAL", at("senna_p", "ADPerStack"), "当前DataValues.ADPerStack=0.75；战前魂层是运行输入，不在本批自动产生。", 10),
  fixed("souls_for_bonus", "黑雾换取一档属性所需层数", "INTEGER", at("senna_p", "StacksForBonus"), "当前DataValues.StacksForBonus=20。", 20),
  fixed("bonus_range_points", "每档黑雾攻击距离", "INTEGER", at("senna_p", "BonusRange"), "当前DataValues.BonusRange=20；只保存明确数值。", 30),
  fixed("bonus_crit_chance_percent_points", "每档黑雾暴击几率百分数点", "INTEGER", at("senna_p", "BonusCritChance"), "当前DataValues.BonusCritChance=10，按百分数点保存。", 40),
  fixed("crit_damage_mod_ratio", "暴击伤害基础效能比例", "DECIMAL", at("senna_p", "CritDamageMod"), "当前DataValues.CritDamageMod=0.8；它与实际CriticalDamage的mStat9输入分开保存。", 50),
  fixed("crit_to_lifesteal_ratio", "溢出暴击转生命偷取比例", "DECIMAL", at("senna_p", "CritToLifestealConversionPercent"), "当前正文以@CritToLifestealConversionPercent*100@%显示，原值0.35按比例保存。", 60),
  runtime("soul_count", "战前黑雾层数", "INTEGER", "当前技能树由BuffCounter消费魂层；由战前状态外供，不默认填0。", 70),
  fixed("bonus_on_hit_ad_ratio", "普攻额外伤总攻击力比例", "DECIMAL", coefficient("senna_p", "BonusOnHitDamage"), "BonusOnHitDamage仅有mStat2与0.2系数；按当前根核对采用来源总攻击力。", 80),
  fixed("move_speed_steal_level_1_5_ratio", "1至5级目标移速偷取比例", "DECIMAL", calcPart("senna_p", "MSSteal").mLevel1Value, "MSSteal角色等级树1级起为0.10，按正文百分数转比例。", 90),
  fixed("move_speed_steal_level_6_8_ratio", "6至8级目标移速偷取比例", "DECIMAL", calcPart("senna_p", "MSSteal").mLevel1Value + calcPart("senna_p", "MSSteal").mBreakpoints[0].mAdditionalBonusAtThisLevel, "MSSteal在6级增加0.05；不把角色等级树改成技能等级。", 100),
  fixed("move_speed_steal_level_9_18_ratio", "9至18级目标移速偷取比例", "DECIMAL", calcPart("senna_p", "MSSteal").mLevel1Value + calcPart("senna_p", "MSSteal").mBreakpoints[0].mAdditionalBonusAtThisLevel + calcPart("senna_p", "MSSteal").mBreakpoints[1].mAdditionalBonusAtThisLevel, "MSSteal在9级再增加0.05；中间区间按当前断点直接记录。", 110),
  fixed("move_speed_steal_duration_ms", "目标移速偷取持续时间（毫秒）", "INTEGER", milliseconds(at("senna_p", "MSStealDuration")), "当前MSStealDuration=0.5秒，转换为500毫秒。", 120),
  fixed("current_health_damage_level1_percent_points", "两次命中当前生命伤害一级起点百分数点", "INTEGER", calcPart("senna_p", "BonusCurentHealthDamage").mLevel1Value, "当前BonusCurentHealthDamage的mLevel1Value=1，正文在数值后拼接%符号。", 130),
  fixed("current_health_damage_initial_bonus_per_level_percent_points", "当前生命伤害每级初始增加百分数点", "INTEGER", calcPart("senna_p", "BonusCurentHealthDamage").mInitialBonusPerLevel, "当前树有mInitialBonusPerLevel=1；角色等级11断点后的具体曲线仍待核。", 140),
  fixed("current_health_damage_breakpoint_level", "当前生命伤害断点等级", "INTEGER", calcPart("senna_p", "BonusCurentHealthDamage").mBreakpoints[0].mLevel, "当前树有11级空断点；只记录断点事实，不线性展开18级。", 150),
  runtime("current_health_damage_percent_points_at_character_level", "当前生命伤害角色等级实际百分数点", "DECIMAL", "当前树是角色等级断点算法，端点之外的实际曲线未证；无默认值，供后续运行层外供。", 160),
  fixed("soul_absorption_interval_level_1_5_ms", "1至5级同英雄吸魂间隔（毫秒）", "INTEGER", milliseconds(calcPart("senna_p", "DebuffDuration").mLevel1Value), "当前DebuffDuration一级起6秒。", 170),
  fixed("soul_absorption_interval_level_6_10_ms", "6至10级同英雄吸魂间隔（毫秒）", "INTEGER", milliseconds(calcPart("senna_p", "DebuffDuration").mLevel1Value + calcPart("senna_p", "DebuffDuration").mBreakpoints[0].mAdditionalBonusAtThisLevel), "当前6级减少1秒为5秒。", 180),
  fixed("soul_absorption_interval_level_11_18_ms", "11至18级同英雄吸魂间隔（毫秒）", "INTEGER", milliseconds(calcPart("senna_p", "DebuffDuration").mLevel1Value + calcPart("senna_p", "DebuffDuration").mBreakpoints[0].mAdditionalBonusAtThisLevel + calcPart("senna_p", "DebuffDuration").mBreakpoints[1].mAdditionalBonusAtThisLevel), "当前11级再减少1秒为4秒。", 190),
  fixed("soul_absorption_breakpoint_1_level", "吸魂间隔第一次断点等级", "INTEGER", calcPart("senna_p", "DebuffDuration").mBreakpoints[0].mLevel, "来自当前DebuffDuration树。", 200),
  fixed("soul_absorption_breakpoint_2_level", "吸魂间隔第二次断点等级", "INTEGER", calcPart("senna_p", "DebuffDuration").mBreakpoints[1].mLevel, "来自当前DebuffDuration树。", 210),
  runtime("critical_damage_ratio_input", "暴击伤害实际比例输入", "DECIMAL", "当前CriticalDamage是mStat9×1且直接显示为百分比；mStat9属性口径由运行层提供，无默认。", 220),
], [
  formula("bonus_on_hit_damage", "赦除普攻额外物理伤害", mul(P("bonus_on_hit_ad_ratio"), AD_TOTAL()), "当前BonusOnHitDamage=0.2×来源总攻击力；两次命中吸魂触发另由事件层接线。", 10),
  formula("soul_attack_damage", "赦除魂层攻击力", mul(P("soul_count"), P("ad_per_soul")), "当前匿名树{bb59ad08}=魂层计数×ADPerStack；只表达战前魂层对自身攻击力的组成。", 20),
], [], [
  { item: "灵魂掉落概率、金币经验和任务奖励", reason: "属于掉落、经济或跨英雄任务分支，超出本批一对一战斗范围。" },
  { item: "超过一个附近英雄时的额外吸魂比例", reason: "需要额外敌方英雄资格，当前仅保留单一当前敌人路径。" },
], [
  { item: "两次命中触发、魂层收集和自身属性应用时点", reason: "数值与战前魂层输入已保留，攻击事件和触发时序待接。" },
  { item: "MSSteal与BonusCurentHealthDamage的角色等级中间曲线", reason: "当前树含断点或初始斜率，未证的中间求值不猜。" },
], "赛娜P沿当前正文与计算树保留魂层、普攻额外伤、当前敌人生命伤害、移速偷取、吸魂间隔和暴击树输入；掉落、经济、任务及额外敌人分支排除。", { bonus_on_hit_damage: ["BonusOnHitDamage"], soul_attack_damage: ["{bb59ad08}"] });

// 赛娜Q
put("senna_q", [
  skillLevels("base_damage", "黑暗洞灭基础物理伤害", "INTEGER", levels("senna_q", "BaseDamage", 5), "当前DataValues.BaseDamage技能等级1至5为30/55/80/105/130；索引0的5不是一级。", 10),
  skillLevels("base_heal", "黑暗洞灭自身治疗基础值", "INTEGER", levels("senna_q", "BaseHeal", 5), "当前DataValues.BaseHeal技能等级1至5为40/60/80/100/120；索引0的20不是一级。", 20),
  fixed("heal_ap_ratio", "黑暗洞灭法强治疗比例", "DECIMAL", at("senna_q", "HealAPRatio"), "当前TotalHeal消费HealAPRatio×来源总法强。", 30),
  fixed("heal_ad_ratio", "黑暗洞灭额外攻击力治疗比例", "DECIMAL", at("senna_q", "HealADRatio"), "当前TotalHeal消费HealADRatio×来源额外攻击力。", 40),
  fixed("bonus_ad_damage_ratio", "黑暗洞灭额外攻击力伤害比例", "DECIMAL", at("senna_q", "BADDamageRatio"), "当前TotalDamage的mStat2带formula2，按来源额外攻击力读取。", 50),
  fixed("base_slow_ratio", "黑暗洞灭基础减速比例", "DECIMAL", at("senna_q", "BaseSlow"), "当前BaseSlow=0.15，正文直接作为减速比例。", 60),
  skillLevels("slow_duration_ms", "黑暗洞灭减速持续时间（毫秒）", "INTEGER", levels("senna_q", "SlowDuration", 5, milliseconds), "当前SlowDuration技能等级1至5为1/1.25/1.5/1.75/2秒。", 70),
  fixed("slow_ap_ratio", "黑暗洞灭法强减速比例", "DECIMAL", at("senna_q", "SlowAPRatio"), "当前TotalSlow消费SlowAPRatio×来源总法强。", 80),
  fixed("slow_ad_ratio", "黑暗洞灭额外攻击力减速比例", "DECIMAL", coefficient("senna_q", "TotalSlow", 2), "当前TotalSlow第三项是mStat2×0.0015且formula2；按来源额外攻击力读取。", 90),
  fixed("cooldown_reduction_on_hit_seconds", "黑暗洞灭命中减冷却时间（秒）", "DECIMAL", at("senna_q", "CDReductionOnHit"), "当前正文明确攻击命中缩短1秒；不改已有公共冷却参数。", 100),
  fixed("spell_cast_time_source_seconds", "黑暗洞灭spellCastTime来源值（秒）", "DECIMAL", rawAt("senna_q", "spellCastTime", 0), "客户端字段为0；它不能替代攻击施法时间，当前正文的攻击施法资格仍待接。", 110),
  fixed("autoattack_cast_time_multiplier", "黑暗洞灭攻击施法时间系数", "DECIMAL", bound("senna_q").raw.mUseAutoattackCastTimeData.mAutoattackCastTimeCalculation.mFormulaParts[0].mNumber, "当前mUseAutoattackCastTimeData仅给0.8乘算，不把它误写成800毫秒。", 120),
], [
  formula("enemy_physical_damage", "黑暗洞灭单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_damage_ratio"), AD_BONUS())), "当前TotalDamage=BaseDamage+0.6×来源额外攻击力；同一目标只结算一条伤害。", 10),
  formula("self_heal", "黑暗洞灭自身治疗", add(add(P("base_heal"), mul(P("heal_ap_ratio"), AP())), mul(P("heal_ad_ratio"), AD_BONUS())), "当前TotalHeal=BaseHeal+0.35×来源法强+0.4×来源额外攻击力；第三友方结果不写入。", 20),
  formula("slow_ratio", "黑暗洞灭单一敌人减速比例", add(add(P("base_slow_ratio"), mul(P("slow_ap_ratio"), AP())), mul(P("slow_ad_ratio"), AD_BONUS())), "当前TotalSlow=BaseSlow+AP×SlowAPRatio+额外AD×0.0015，按正文百分数显示。", 30),
], [manaCostEffect("senna_q")], [
  { item: "第三友方英雄治疗", reason: "本轮只保留赛娜自身治疗资格，第三友方纯收益不生成结果。" },
  { item: "攻击特效、攻击距离和攻速最终施放事件", reason: "正文明确存在，但事件资格和施法时序未接；保留来源参数并列待接。" },
], [
  { item: "spellCastTime=0与攻击施法系数0.8的实际时序", reason: "两个来源字段语义不同，未据其中任一字段固定施法时长。" },
], "赛娜Q纠正DataValues下标，保留一级基础伤害30和治疗40；伤害、自己治疗和减速三条计算树分别按额外攻击力/法强属性读取。", { enemy_physical_damage: ["TotalDamage"], self_heal: ["TotalHeal"], slow_ratio: ["TotalSlow"] });

// 赛娜W
put("senna_w", [
  skillLevels("base_damage", "无尽厮守基础物理伤害", "INTEGER", levels("senna_w", "BaseDamage", 5), "当前DataValues.BaseDamage技能等级1至5为70/110/150/190/230；索引0的30不是一级。", 10),
  fixed("bonus_ad_ratio", "无尽厮守额外攻击力伤害比例", "DECIMAL", coefficient("senna_w", "Damage"), "当前Damage的mStat2无formula但根源值按窄口径核为额外攻击力。", 20),
  skillLevels("root_duration_ms", "无尽厮守禁锢持续时间（毫秒）", "INTEGER", levels("senna_w", "RootDuration", 5, milliseconds), "当前RootDuration技能等级1至5为1.25/1.5/1.75/2/2.25秒。", 30),
  skillLevels("delay_ms", "无尽厮守禁锢延迟（毫秒）", "INTEGER", levels("senna_w", "DelayTime", 5, milliseconds), "当前DelayTime索引1至5均为1秒；索引0的0不是一级。", 40),
  fixed("mcast_time_source_seconds", "无尽厮守mCastTime来源值（秒）", "DECIMAL", rawAt("senna_w", "mCastTime", 0), "当前mCastTime=0.25秒。", 50),
  fixed("spell_cast_time_source_seconds", "无尽厮守spellCastTime来源值（秒）", "DECIMAL", rawAt("senna_w", "spellCastTime", 0), "当前spellCastTime=0，与mCastTime冲突，不能任选其一作为最终施法时长。", 60),
], [formula("enemy_physical_damage", "无尽厮守单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前Damage=BaseDamage+0.9×来源额外攻击力；只保留第一个命中的当前敌人。", 10)], [manaCostEffect("senna_w")], [
  { item: "目标附近其它敌人的禁锢分配", reason: "需要额外敌人范围，本轮只保留当前唯一敌人禁锢。" },
], [
  { item: "mCastTime与spellCastTime冲突及延迟后事件", reason: "保留两个原始字段和延迟数值，命中、延迟和禁锢接线待补。" },
], "赛娜W采用技能等级1起70伤害、1.25秒禁锢和1秒延迟；额外敌人分支排除，施法两个来源字段原样记录。", { enemy_physical_damage: ["Damage"] });

// 赛娜E
put("senna_e", [
  skillLevels("buff_duration_ms", "黑雾咒附自身持续时间（毫秒）", "INTEGER", levels("senna_e", "BuffDuration", 5, milliseconds), "当前BuffDuration技能等级1至5为6/6.5/7/7.5/8秒；索引0的5.5不是一级。", 10),
  fixed("movement_speed_ratio", "黑雾咒附基础移动速度比例", "DECIMAL", at("senna_e", "MovementSpeedPercent"), "当前MovementSpeedPercent=0.2，正文按百分数显示。", 20),
  fixed("ms_ap_ratio", "黑雾咒附法强移动速度比例", "DECIMAL", at("senna_e", "MSAPRatio"), "当前TotalMS消费MSAPRatio×来源总法强。", 30),
  fixed("defense_radius", "黑雾咒附敌人接近判定半径", "INTEGER", at("senna_e", "DefenseRadius"), "当前正文以附近敌人决定是否隐藏身份；只保存原始半径，不把它变成无条件无敌。", 40),
  fixed("duration_before_restealth_ms", "黑雾咒附重新伪装等待时间（毫秒）", "INTEGER", milliseconds(at("senna_e", "DurationBeforeRestealth")), "当前DurationBeforeRestealth=1.5秒。", 50),
  fixed("smoke_linger_ms", "黑雾咒附烟雾残留时间（毫秒）", "INTEGER", milliseconds(at("senna_e", "SmokeLinger")), "当前SmokeLinger=3.5秒。", 60),
  fixed("smoke_arm_time_ms", "黑雾咒附烟雾准备时间（毫秒）", "INTEGER", milliseconds(at("senna_e", "SmokeArmTime")), "当前SmokeArmTime=0.25秒。", 70),
  fixed("smoke_radius", "黑雾咒附烟雾半径", "INTEGER", at("senna_e", "SmokeRadius"), "当前SmokeRadius=150；只保存范围来源值。", 80),
  fixed("mcast_time_source_seconds", "黑雾咒附mCastTime来源值（秒）", "DECIMAL", rawAt("senna_e", "mCastTime", 0), "当前mCastTime=1秒。", 90),
  fixed("spell_cast_time_source_seconds", "黑雾咒附spellCastTime来源值（秒）", "DECIMAL", rawAt("senna_e", "spellCastTime", 0), "当前spellCastTime=0，与mCastTime冲突，不能任选其一作为最终施法时长。", 100),
], [formula("self_move_speed_ratio", "黑雾咒附自身移动速度比例", add(P("movement_speed_ratio"), mul(P("ms_ap_ratio"), AP())), "当前TotalMS=MovementSpeedPercent+MSAPRatio×来源总法强，结果供自身属性效果引用。", 10)], [
  manaCostEffect("senna_e"),
  attributeEffect("self_move_speed", "黑雾咒附自身幽魂移动速度", formulaValue("self_move_speed_ratio"), "move_speed_percent", timedLifecycle("buff_duration_ms"), "只定义来源明确的自身移动速度属性，伪装/幽魂触发与附近敌人条件由后续事件层接线。"),
], [
  { item: "第三友方英雄伪装和友方最短持续时间", reason: "纯第三友方收益，超出本批范围。" },
  { item: "全程无条件不可选中", reason: "当前正文明确存在附近敌人和揭示条件，不能造无条件免疫。" },
], [
  { item: "mDoesNotConsumeCooldown与已有公共冷却的关系", reason: "当前根字段与已保护公共参数冲突，不覆盖已有对象。" },
  { item: "伪装、幽魂和不可选中触发时点", reason: "保留自身移动速度生命周期，状态资格与结束事件待接。" },
], "赛娜E只写自身持续时间和TotalMS计算及自身移动速度属性候选；友军伪装排除，附近敌人条件与两个施法字段冲突保留待接。", { self_move_speed_ratio: ["TotalMS"] });

// 赛娜R
put("senna_r", [
  skillLevels("damage", "暗影燎原基础物理伤害", "INTEGER", levels("senna_r", "Damage", 3), "当前DataValues.Damage技能等级1至3为250/400/550；索引0的100不是一级。", 10),
  skillLevels("shield", "暗影燎原基础护盾值", "INTEGER", levels("senna_r", "Shield", 3), "当前DataValues.Shield技能等级1至3为120/160/200；索引0的80不是一级。", 20),
  fixed("shield_duration_ms", "暗影燎原护盾持续时间（毫秒）", "INTEGER", milliseconds(at("senna_r", "ShieldDuration")), "当前ShieldDuration=3秒。", 30),
  fixed("damage_ap_ratio", "暗影燎原法强伤害比例", "DECIMAL", at("senna_r", "DamageAPRatio"), "当前TotalDamage消费DamageAPRatio×来源总法强。", 40),
  fixed("damage_bonus_ad_ratio", "暗影燎原额外攻击力伤害比例", "DECIMAL", coefficient("senna_r", "TotalDamage", 2), "当前TotalDamage第三项mStat2带formula2，按来源额外攻击力读取。", 50),
  fixed("shield_ap_ratio", "暗影燎原法强护盾比例", "DECIMAL", at("senna_r", "ShieldAPRatio"), "当前根数据给出ShieldAPRatio=0.5。", 60),
  fixed("shield_soul_ratio", "暗影燎原每层魂护盾比例", "DECIMAL", calcPart("senna_r", "TotalShield", 2).mCoefficient, "当前TotalShield第三项为魂层计数×1.5；战前魂层输入单独保存。", 70),
  runtime("soul_count", "暗影燎原战前黑雾层数", "INTEGER", "护盾计算树消费魂层计数；无默认值，与赛娜P的战前层数同口径但不跨技能自动引用。", 80),
  fixed("spell_cast_time_ms", "暗影燎原根施法时间（毫秒）", "INTEGER", milliseconds(rawAt("senna_r", "spellCastTime", 0)), "当前spellCastTime=1秒。", 90),
  fixed("post_cast_animation_lock_ms", "暗影燎原施法后动作锁（毫秒）", "INTEGER", milliseconds(at("senna_r", "PostCastAnimLock")), "当前PostCastAnimLock=0.5秒，与根施法分开。", 100),
], [
  formula("enemy_physical_damage", "暗影燎原单一敌人物理伤害", add(add(P("damage"), mul(P("damage_ap_ratio"), AP())), mul(P("damage_bonus_ad_ratio"), AD_BONUS())), "当前TotalDamage=Damage+0.7×来源法强+1.15×来源额外攻击力。", 10),
  formula("self_shield", "暗影燎原自身护盾", add(add(P("shield"), mul(P("shield_ap_ratio"), AP())), mul(P("shield_soul_ratio"), P("soul_count"))), "当前TotalShield=Shield+0.5×来源法强+1.5×战前魂层；第三友方护盾不写入。", 20),
], [manaCostEffect("senna_r"), normalShieldEffect("self_shield", "暗影燎原自身护盾", "self_shield", "shield_duration_ms", "只定义自身护盾数值与3秒生命周期；友方目标选择和施放事件由后续接线。", 20)], [
  { item: "第三友方英雄护盾", reason: "本轮只保留赛娜自身护盾资格，第三友方纯收益排除。" },
  { item: "多名敌方伤害分配", reason: "额外敌人分支超出唯一当前敌人范围。" },
], [
  { item: "光束命中与自身护盾施放事件", reason: "数值、根施法1秒和动作锁0.5秒已分开，目标资格与事件顺序待接。" },
], "赛娜R采用等级1起250伤害和120护盾，护盾含魂层项并按3秒生命周期定义自身普通护盾。", { enemy_physical_damage: ["TotalDamage"], self_shield: ["TotalShield"] });

// 锤石P
put("thresh_p", [
  fixed("stat_value_per_soul", "每个灵魂的护甲与法强", "DECIMAL", at("thresh_p", "StatValuePerSoul"), "当前正文明确每魂同时提供1护甲和1法强。", 10),
  fixed("souls_to_gain_on_pickup", "每次拾取获得的灵魂数", "INTEGER", at("thresh_p", "SoulsToGainOnPickUp"), "当前DataValues.SoulsToGainOnPickUp=1。", 20),
  runtime("soul_count", "战前灵魂层数", "INTEGER", "CurrentSoulBonus消费BuffCounterByNamedDataValue；由战前状态外供，不默认填0。", 30),
], [formula("current_soul_bonus", "地狱诅咒当前灵魂属性加成", mul(P("soul_count"), P("stat_value_per_soul")), "当前CurrentSoulBonus=灵魂层数×StatValuePerSoul；同一数值分别用于自身护甲与法强，属性应用待接。", 10)], [], [
  { item: "小兵和野怪灵魂掉落规则", reason: "兵野掉落与概率属于本轮范围外；战前已有灵魂层数仍保留。" },
], [
  { item: "拾取事件和护甲/法强双属性应用", reason: "共享数值已保存，具体事件时点与双属性接线待补。" },
], "锤石P保留当前正文消费的魂层共享数值和每魂属性，不因魂层来自掉落就删除战前输入。", { current_soul_bonus: ["CurrentSoulBonus"] });

// 锤石Q
put("thresh_q", [
  skillLevels("base_damage", "死亡判决基础魔法伤害", "INTEGER", levels("thresh_q", "BaseDamage", 5), "当前DataValues.BaseDamage技能等级1至5为100/150/200/250/300；索引0的50不是一级。", 10),
  fixed("ap_ratio", "死亡判决法强伤害比例", "DECIMAL", at("thresh_q", "APRatio"), "当前TotalDamage消费APRatio×来源总法强。", 20),
  fixed("control_duration_ms", "死亡判决晕眩拉拽持续时间（毫秒）", "INTEGER", milliseconds(at("thresh_q", "TauntLength")), "原始字段名TauntLength不代表嘲讽；当前正文语义是1.5秒晕眩和拉拽。", 30),
  fixed("slow_ratio", "死亡判决原始减速比例", "DECIMAL", at("thresh_q", "SlowPercent") / 100, "当前SlowPercent=75是百分数点；当前事件是否使用该字段待核。", 40),
  fixed("hit_bonus_cooldown_ms", "死亡判决命中减冷却时间（毫秒）", "INTEGER", milliseconds(at("thresh_q", "HitBonusCooldown")), "当前命中缩短2秒；不改已有公共冷却。", 50),
  fixed("mcast_time_source_seconds", "死亡判决mCastTime来源值（秒）", "DECIMAL", rawAt("thresh_q", "mCastTime", 0), "当前mCastTime=0.5秒。", 60),
  fixed("spell_cast_time_source_seconds", "死亡判决spellCastTime来源值（秒）", "DECIMAL", rawAt("thresh_q", "spellCastTime", 0), "当前spellCastTime=0.25秒，与mCastTime冲突，不能任选其一。", 70),
], [formula("enemy_magic_damage", "死亡判决单一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), AP())), "当前TotalDamage=BaseDamage+0.9×来源总法强；真实视野是过程附带信息，不生成结果。", 10)], [manaCostEffect("thresh_q")], [
  { item: "纯真实视野", reason: "本轮保留伤害、控制和自身再施放位移，纯视野不生成机制结果。" },
], [
  { item: "mCastTime与spellCastTime冲突、再施放位移时序", reason: "原始字段和再施放事实保留，事件层待接。" },
], "锤石Q采用100起的五级伤害和0.9法强比例；TauntLength按控制时长记录，避免把字段名当成嘲讽。", { enemy_magic_damage: ["TotalDamage"] });

// 锤石W
put("thresh_w", [
  skillLevels("base_shield", "魂引之灯基础护盾值", "INTEGER", levels("thresh_w", "BaseShieldValue", 5), "当前DataValues.BaseShieldValue技能等级1至5为50/70/90/110/130；索引0的30不是一级。", 10),
  fixed("shield_per_soul", "魂引之灯每魂护盾值", "INTEGER", at("thresh_w", "ShieldPerSoul"), "当前TotalShield消费每魂2点护盾。", 20),
  fixed("shield_duration_ms", "魂引之灯自身护盾持续时间（毫秒）", "INTEGER", milliseconds(at("thresh_w", "ShieldDuration")), "当前ShieldDuration=4秒。", 30),
  fixed("lantern_duration_ms", "魂引之灯灯笼持续时间（毫秒）", "INTEGER", milliseconds(at("thresh_w", "LanternDuration")), "灯笼6秒与自身护盾4秒分开。", 40),
  runtime("soul_count", "魂引之灯战前灵魂层数", "INTEGER", "护盾计算消费魂层；由战前状态外供，不默认填0。", 50),
], [formula("self_shield", "魂引之灯自身护盾", add(P("base_shield"), mul(P("shield_per_soul"), P("soul_count"))), "当前TotalShield=BaseShieldValue+2×魂层；第三友方护盾和点击位移不写入。", 10)], [manaCostEffect("thresh_w"), normalShieldEffect("self_shield", "魂引之灯自身护盾", "self_shield", "shield_duration_ms", "只定义锤石自身普通护盾的4秒生命周期；灯笼投掷事件由后续接线。", 20)], [
  { item: "第一个友方英雄护盾和点击灯笼位移", reason: "属于第三友方收益，超出本轮唯一自身/敌人范围。" },
], [
  { item: "灯笼投掷和自身护盾触发时点", reason: "4秒自身护盾和6秒灯笼数值已分开，事件接线待补。" },
], "锤石W按等级1起50基础护盾和2倍灵魂层数生成自身普通护盾；灯笼6秒与护盾4秒分别记录。", { self_shield: ["TotalShield"] });

// 锤石E
put("thresh_e", [
  fixed("passive_damage_per_soul", "厄运钟摆每魂被动伤害", "DECIMAL", coefficient("thresh_e", "PAttackDamageMin"), "当前PAttackDamageMin只消费1.7×魂层；旧PassiveDmgPerSoul=1.5未进入当前树。", 10),
  runtime("soul_count", "厄运钟摆战前灵魂层数", "INTEGER", "被动伤害树消费魂层；由战前状态外供，不默认填0。", 20),
  skillLevels("passive_ad_ratio", "厄运钟摆满蓄总攻击力比例", "DECIMAL", levels("thresh_e", "PassiveADRatioTT", 5), "当前PAttackDamageMax消费PassiveADRatioTT，技能等级1至5为0.9/1.2/1.5/1.8/2.1，属性为来源总攻击力。", 30),
  skillLevels("active_base_damage", "厄运钟摆主动基础魔法伤害", "INTEGER", levels("thresh_e", "ActiveBaseDamage", 5), "当前ActiveBaseDamage技能等级1至5为65/110/155/200/245；索引0的20不是一级。", 40),
  fixed("active_ap_ratio", "厄运钟摆主动法强伤害比例", "DECIMAL", at("thresh_e", "APRatio"), "当前TotalDamage消费APRatio×来源总法强。", 50),
  skillLevels("active_slow_ratio", "厄运钟摆主动减速比例", "DECIMAL", levels("thresh_e", "ActiveSlowPercentage", 5, value => clean(value / 100)), "当前ActiveSlowPercentage原值20/25/30/35/40为百分数点，按正文换算为0.2/0.25/0.3/0.35/0.4。", 60),
  fixed("slow_duration_ms", "厄运钟摆主动减速持续时间（毫秒）", "INTEGER", milliseconds(at("thresh_e", "SlowDuration")), "当前SlowDuration=1秒。", 70),
  fixed("full_charge_duration_ms", "厄运钟摆被动满蓄等待时间（毫秒）", "INTEGER", milliseconds(at("thresh_e", "FullChargeDuration")), "当前FullChargeDuration=10秒；实际蓄力进度与普攻间隔待接。", 80),
  fixed("cast_time_seconds", "厄运钟摆spellCastTime原始值（秒）", "DECIMAL", rawAt("thresh_e", "spellCastTime", 0), "当前值0.3888999819755554秒，保留十进制来源，不无证四舍五入成整数毫秒。", 90),
], [
  formula("passive_damage_min", "厄运钟摆被动最低魔法伤害", mul(P("passive_damage_per_soul"), P("soul_count")), "当前PAttackDamageMin=1.7×魂层。", 10),
  formula("passive_damage_max", "厄运钟摆被动满蓄最高魔法伤害", add(mul(P("passive_damage_per_soul"), P("soul_count")), mul(P("passive_ad_ratio"), AD_TOTAL())), "当前PAttackDamageMax=1.7×魂层+PassiveADRatioTT×来源总攻击力；满蓄事件待接。", 20),
  formula("active_magic_damage", "厄运钟摆主动单一敌人魔法伤害", add(P("active_base_damage"), mul(P("active_ap_ratio"), AP())), "当前TotalDamage=ActiveBaseDamage+0.6×来源总法强；只保留命中当前敌人。", 30),
], [manaCostEffect("thresh_e")], [
  { item: "PassiveDmgPerSoul=1.5", reason: "该旧DataValue未进入当前PAttackDamageMin/PAttackDamageMax树，不能替代当前1.7。" },
  { item: "ActiveSlowPercentage原始百分数点作为90倍等大数", reason: "原值20/25/30/35/40是显示百分数点，候选已按0.2至0.4比例保存。" },
  { item: "额外敌人分配", reason: "本轮只保留当前敌人主动伤害和自身被动伤害。" },
], [
  { item: "普攻间隔、蓄力进度和拉拽推挤事件", reason: "保留10秒满蓄和最低/最高组成，实际时序与命中接线待补。" },
], "锤石E只消费当前PAttackDamageMin/PAttackDamageMax和TotalDamage树；被动1.7与主动65起、减速百分数均按当前绑定正文核对。", { passive_damage_min: ["PAttackDamageMin"], passive_damage_max: ["PAttackDamageMax"], active_magic_damage: ["TotalDamage"] });

// 锤石R
put("thresh_r", [
  skillLevels("damage", "幽冥监牢基础魔法伤害", "INTEGER", levels("thresh_r", "Damage", 3), "当前DataValues.Damage技能等级1至3为250/400/550；索引0为0，后续175也不是前三个技能等级。", 10),
  fixed("ap_ratio", "幽冥监牢法强伤害比例", "DECIMAL", at("thresh_r", "APRatio"), "当前TotalDamage消费APRatio×来源总法强。", 20),
  fixed("slow_ratio", "幽冥监牢首墙减速比例", "DECIMAL", at("thresh_r", "SlowAmount") / 100, "当前SlowAmount=99是百分数点，按0.99比例保存。", 30),
  fixed("slow_duration_ms", "幽冥监牢首墙减速持续时间（毫秒）", "INTEGER", milliseconds(at("thresh_r", "SlowDuration")), "当前首墙SlowDuration=2秒。", 40),
  fixed("remaining_wall_slow_duration_ms", "幽冥监牢剩余墙同一敌人减速持续时间（毫秒）", "INTEGER", milliseconds(at("thresh_r", "SlowDuration") / 2), "正文明确剩余墙减半为1秒；只保留同一敌人可再次碰墙的当前路径。", 50),
  fixed("wall_duration_ms", "幽冥监牢墙体持续时间（毫秒）", "INTEGER", milliseconds(at("thresh_r", "WallDuration")), "当前WallDuration=4秒。", 60),
  fixed("spell_cast_time_source_seconds", "幽冥监牢spellCastTime来源值（秒）", "DECIMAL", rawAt("thresh_r", "spellCastTime", 0), "当前spellCastTime=0.25秒。", 70),
  fixed("mcast_time_source_seconds", "幽冥监牢mCastTime来源值（秒）", "DECIMAL", rawAt("thresh_r", "mCastTime", 0), "当前mCastTime=0.45秒，与spellCastTime冲突。", 80),
], [formula("enemy_magic_damage", "幽冥监牢单一敌人魔法伤害", add(P("damage"), mul(P("ap_ratio"), AP())), "当前TotalDamage=Damage+1×来源总法强；剩余墙对同一敌人只保留1秒减速，不重复生成伤害。", 10)], [manaCostEffect("thresh_r")], [
  { item: "额外墙体的多目标伤害分配", reason: "额外目标分支排除；同一敌人剩余墙的1秒减速已保留。" },
], [
  { item: "首墙碰撞、墙体消失和剩余墙事件", reason: "保留首墙与剩余墙同一敌人持续时间差，具体事件顺序待接。" },
  { item: "mCastTime与spellCastTime冲突", reason: "两个来源值均原样记录，不任选施法字段。" },
], "锤石R保留前三个技能等级250/400/550的首墙伤害、99%减速2秒和剩余墙同敌1秒减速；多目标分配排除。", { enemy_magic_damage: ["TotalDamage"] });

// 派克P
put("pyke_p", [
  fixed("one_enemy_base_storage_ratio", "单一敌人伤害储存基础比例", "DECIMAL", at("pyke_p", "OneEnemy"), "当前OneEnemy=0.09，正文按百分数显示。", 10),
  fixed("one_enemy_lethality_ratio", "单一敌人穿甲点储存比例", "DECIMAL", coefficient("pyke_p", "OneEnemyCalc", 1), "当前OneEnemyCalc第二项是mStat29×0.002；mStat29保留为穿甲点数输入，不猜属性键。", 20),
  runtime("lethality_points_input", "派克固定穿甲点数输入", "DECIMAL", "当前OneEnemyCalc与W/E/R树消费mStat29；实际点数由运行层外供，无默认。", 30),
  fixed("storage_max_base", "伤害储存上限基础值", "INTEGER", calcPart("pyke_p", "DamageStorageMax").mNumber, "当前DamageStorageMax显式基础值80。", 40),
  fixed("storage_max_bonus_ad_ratio", "伤害储存上限额外攻击力比例", "DECIMAL", at("pyke_p", "DamageStoreMaxBonusADRatio"), "当前DamageStorageMax的mStat2带formula2，按来源额外攻击力读取。", 50),
  fixed("hp_per_bonus_ad", "最大生命转攻击力所需生命值", "INTEGER", at("pyke_p", "HPPerBAD"), "当前正文和DataValues均为14生命值转1攻击力。", 60),
], [
  formula("one_enemy_storage_ratio", "溺水之幸单一敌人储存比例", add(P("one_enemy_base_storage_ratio"), mul(P("one_enemy_lethality_ratio"), P("lethality_points_input"))), "当前OneEnemyCalc=0.09+0.002×mStat29，结果按正文百分数显示。", 10),
  formula("damage_storage_max", "溺水之幸伤害储存上限", add(P("storage_max_base"), mul(P("storage_max_bonus_ad_ratio"), AD_BONUS())), "当前DamageStorageMax=80+8×来源额外攻击力。", 20),
], [], [
  { item: "附近有多个英雄时的AdditionalBonusCalc", reason: "需要额外敌方英雄资格，单一当前敌人路径不写该专用分支。" },
  { item: "经济、队友和英雄以外的储存来源", reason: "不属于本轮唯一当前敌人和自身收益范围。" },
], [
  { item: "离开敌方视野后的灰色生命回复节拍与触发", reason: "正文明确自身回复，周期和实际储存事件未证，保留为待接行为。" },
  { item: "mStat29的运行时属性资格", reason: "只保存命名穿甲点输入，不把来源字段名替换成未经证明的属性枚举。" },
], "派克P保留单一敌人储存比例、80+8额外攻击力上限、14生命转攻击力以及自身灰色生命回复边界；额外英雄比例列为排除。", { one_enemy_storage_ratio: ["OneEnemyCalc"], damage_storage_max: ["DamageStorageMax"] });

// 派克Q
put("pyke_q", [
  skillLevels("base_damage", "透骨尖钉基础物理伤害", "INTEGER", levels("pyke_q", "BaseDamage", 5), "当前DataValues.BaseDamage技能等级1至5为100/150/200/250/300；索引0的50不是一级。", 10),
  fixed("bonus_ad_ratio", "透骨尖钉额外攻击力伤害比例", "DECIMAL", at("pyke_q", "BonusADRatio"), "当前TotalDamage的mStat2带formula2，按来源额外攻击力读取。", 20),
  fixed("slow_ratio", "透骨尖钉减速比例", "DECIMAL", at("pyke_q", "SlowAmount"), "当前正文使用@SlowAmount*100@%，原值0.9已是比例。", 30),
  fixed("slow_duration_ms", "透骨尖钉减速持续时间（毫秒）", "INTEGER", milliseconds(at("pyke_q", "SlowDuration")), "当前SlowDuration=1秒。", 40),
  fixed("mana_refund_ratio", "透骨尖钉返还法力比例", "DECIMAL", at("pyke_q", "ManaRefund"), "当前正文明确命中英雄或未完成引导返还75%。", 50),
  runtime("actual_mana_spent", "透骨尖钉本次实际已消耗法力", "DECIMAL", "返还比例乘本次真实已扣法力；不能默认使用公共基础法力参数。", 60),
  fixed("min_charge_time_ms", "透骨尖钉最短蓄力时间（毫秒）", "INTEGER", milliseconds(at("pyke_q", "MinChargeTime")), "当前MinChargeTime=0.5秒。", 70),
  fixed("max_charge_time_ms", "透骨尖钉最长蓄力时间（毫秒）", "INTEGER", milliseconds(at("pyke_q", "MaxChargeTime")), "当前MaxChargeTime=3秒。", 80),
  fixed("self_slow_ratio", "透骨尖钉蓄力自身减速比例", "DECIMAL", at("pyke_q", "SelfSlow"), "当前SelfSlow=0.2；事件时点待接。", 90),
  fixed("pull_distance", "透骨尖钉长蓄拉拽距离", "INTEGER", at("pyke_q", "PullDistance"), "当前PullDistance=500。", 100),
  fixed("min_range", "透骨尖钉短蓄距离", "INTEGER", at("pyke_q", "MinRangeDistance"), "当前MinRangeDistance=500。", 110),
  fixed("max_range", "透骨尖钉满距距离", "INTEGER", at("pyke_q", "MaxRangeDistance"), "当前MaxRangeDistance=1100。", 120),
  fixed("charge_time_to_max_range_ms", "透骨尖钉达到最大距离时间（毫秒）", "INTEGER", milliseconds(at("pyke_q", "ChargeTimeToGetMaxRange")), "当前ChargeTimeToGetMaxRange=1秒。", 130),
  fixed("spell_cast_time_source_seconds", "透骨尖钉spellCastTime来源值（秒）", "DECIMAL", rawAt("pyke_q", "spellCastTime", 0), "当前spellCastTime=0；蓄力和事件时序不能由此固定。", 140),
], [
  formula("enemy_physical_damage", "透骨尖钉单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "秒放与长蓄共同消费同一TotalDamage，不能叠加两次。", 10),
  formula("mana_refund_amount", "透骨尖钉条件法力返还", mul(P("mana_refund_ratio"), P("actual_mana_spent")), "只在命中英雄或引导未成功完成时返还，本次实际消耗是无默认运行输入。", 20),
], [manaCostEffect("pyke_q", "根字段mDoesNotConsumeMana与已保护法力参数冲突；保留基础成本对象，不自动判断扣除。"), manaRefundEffect("mana_refund_amount", "透骨尖钉条件法力返还", "只记录75%×本次实际消耗，触发条件由事件层接线。")], [
  { item: "秒放和长蓄的两条伤害各自重复计算", reason: "两种分支都指向同一TotalDamage，本候选只建立一条伤害公式。" },
], [], "派克Q保留同一敌人的共同伤害、减速、蓄力范围和条件法力返还；根mDoesNotConsumeMana冲突保留为待接，不删已保护法力。", { enemy_physical_damage: ["TotalDamage"], mana_refund_amount: ["ManaRefund"] });

// 派克W
put("pyke_w", [
  fixed("base_move_speed_ratio", "幽潭潜行基础移动速度比例", "DECIMAL", at("pyke_w", "BaseMoveSpeed") / 100, "当前BaseMoveSpeed=45百分数点；写入移动速度比例属性时按0.01换算为0.45。", 10),
  fixed("lethality_move_speed_ratio_per_point", "幽潭潜行每点穿甲移动速度比例", "DECIMAL", coefficient("pyke_w", "MoveSpeed") / 100, "当前MoveSpeed=45+2×mStat29百分数点；2点百分数除以100后为0.02，不能把45当比例。", 20),
  runtime("lethality_points_input", "幽潭潜行固定穿甲点数输入", "DECIMAL", "当前MoveSpeed树消费mStat29；实际穿甲点数由运行层提供，无默认。", 30),
  fixed("camo_duration_ms", "幽潭潜行伪装持续时间（毫秒）", "INTEGER", milliseconds(at("pyke_w", "CamoDuration")), "当前CamoDuration=5秒。", 40),
  fixed("level_move_speed_level1_ratio", "幽潭潜行匿名等级移速一级值", "DECIMAL", calcPart("pyke_w", "{601654a1}").mLevel1Value, "当前匿名树为角色等级移速来源，一级0.25；不凭匿名名称扩展为治疗。", 50),
  fixed("level_move_speed_initial_bonus_per_level_ratio", "幽潭潜行匿名等级移速初始斜率", "DECIMAL", calcPart("pyke_w", "{601654a1}").mInitialBonusPerLevel, "当前匿名树初始斜率0.03，角色等级中间求值未作为技能等级展开。", 60),
  fixed("level_move_speed_breakpoint_1_level", "幽潭潜行匿名等级移速第一次断点", "INTEGER", calcPart("pyke_w", "{601654a1}").mBreakpoints[0].mLevel, "当前匿名树4级替换斜率。", 70),
  fixed("level_move_speed_breakpoint_1_slope_ratio", "幽潭潜行匿名等级移速第一次斜率", "DECIMAL", calcPart("pyke_w", "{601654a1}").mBreakpoints[0].mBonusPerLevelAtAndAfter, "当前4级后的斜率0.02；不线性生成18级表。", 80),
  fixed("level_move_speed_breakpoint_2_level", "幽潭潜行匿名等级移速第二次断点", "INTEGER", calcPart("pyke_w", "{601654a1}").mBreakpoints[1].mLevel, "当前匿名树8级替换斜率。", 90),
  fixed("level_move_speed_breakpoint_2_slope_ratio", "幽潭潜行匿名等级移速第二次斜率", "DECIMAL", calcPart("pyke_w", "{601654a1}").mBreakpoints[1].mBonusPerLevelAtAndAfter, "当前8级后的斜率0.01；中间角色等级值待运行层外供。", 100),
  runtime("level_move_speed_ratio_at_character_level", "幽潭潜行匿名等级移速实际值", "DECIMAL", "当前匿名计算树有角色等级斜率替换，不能用端点或固定技能等级猜值。", 110),
], [formula("move_speed_bonus_ratio", "幽潭潜行自身移动速度比例", add(P("base_move_speed_ratio"), mul(P("lethality_move_speed_ratio_per_point"), P("lethality_points_input"))), "当前MoveSpeed百分数点=45+2×mStat29；转换为移动速度比例后供后续自身属性接线。", 10)], [manaCostEffect("pyke_w")], [
  { item: "W匿名治疗树、BaseHealCap、MaxHPHealCap、HealADRatio和回复节拍", reason: "当前W正文只消费伪装和移动速度；没有当前消费证明的治疗树不套成P自动回复。" },
], [
  { item: "移动速度衰减、伪装触发和匿名等级树应用", reason: "保留5秒和原始衰减/断点组成，实际随时间衰减和事件接线待补。" },
], "派克W将45+2穿甲点百分数正确除以100作为移动速度比例，并保留当前消费的匿名等级移速树；治疗匿名树列为排除。", { move_speed_bonus_ratio: ["MoveSpeed", "{601654a1}"] });

// 派克E
put("pyke_e", [
  skillLevels("base_damage", "魅影浪洄基础物理伤害", "INTEGER", levels("pyke_e", "BaseDamage", 5), "当前DataValues.BaseDamage技能等级1至5为100/150/200/250/300；数组首项重复100，不按索引0错取二级。", 10),
  fixed("bonus_ad_ratio", "魅影浪洄额外攻击力伤害比例", "DECIMAL", coefficient("pyke_e", "TotalDamage", 1), "当前TotalDamage的mStat2无formula，按技能来源窄口径取额外攻击力。", 20),
  fixed("base_stun_duration_ms", "魅影浪洄基础晕眩时间（毫秒）", "INTEGER", milliseconds(at("pyke_e", "BaseStunDuration")), "当前BaseStunDuration=1.25秒。", 30),
  fixed("lethality_stun_bonus_ms_per_point", "魅影浪洄每点穿甲晕眩增加（毫秒）", "INTEGER", milliseconds(coefficient("pyke_e", "StunDuration", 1)), "当前StunDuration每点mStat29增加0.01秒，转换为10毫秒；不改变展示精度语义。", 40),
  runtime("lethality_points_input", "魅影浪洄固定穿甲点数输入", "DECIMAL", "当前StunDuration消费mStat29；实际穿甲点数由运行层提供，无默认。", 50),
  fixed("dash_distance", "魅影浪洄位移距离", "INTEGER", at("pyke_e", "DashDistance"), "当前DashDistance=550。", 60),
  fixed("stun_delay_ms", "魅影浪洄残影晕眩延迟（毫秒）", "INTEGER", milliseconds(at("pyke_e", "StunDelay")), "当前StunDelay=1秒；残影是技能载体，不扩大成独立召唤。", 70),
  fixed("cast_time_ms", "魅影浪洄mCastTime施法时间（毫秒）", "INTEGER", milliseconds(rawAt("pyke_e", "mCastTime", 0)), "当前mCastTime=0.275秒，转换为275毫秒。", 80),
], [
  formula("enemy_physical_damage", "魅影浪洄单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前TotalDamage=BaseDamage+1×来源额外攻击力。", 10),
  formula("stun_duration_ms", "魅影浪洄单一敌人晕眩时间", add(P("base_stun_duration_ms"), mul(P("lethality_stun_bonus_ms_per_point"), P("lethality_points_input"))), "当前StunDuration=1.25秒+0.01秒×mStat29，统一以毫秒表达。", 20),
], [manaCostEffect("pyke_e")], [
  { item: "把残影当成独立召唤", reason: "当前技能描述把残影作为返回载体；本轮保留当前敌人控制和伤害，不创建召唤单位。" },
], [
  { item: "位移返回、残影命中和1秒延迟事件", reason: "位移与控制来源数值已保存，返回路径和命中事件待接。" },
], "派克E纠正重复首项后的技能等级伤害，保留额外攻击力、穿甲晕眩增量、550位移和275毫秒mCastTime。", { enemy_physical_damage: ["TotalDamage"], stun_duration_ms: ["StunDuration"] });

// 派克R
put("pyke_r", [
  fixed("recast_duration_ms", "涌泉之恨再次施放窗口（毫秒）", "INTEGER", milliseconds(at("pyke_r", "RRecastDuration")), "当前RRecastDuration=20秒。", 10),
  fixed("reduced_damage_ratio", "涌泉之恨未斩杀伤害比例", "DECIMAL", at("pyke_r", "ReducedDamage"), "当前ReducedDamage=0.5；最终公式乘完整斩杀阈值。", 20),
  fixed("r_base_damage_level1", "涌泉之恨角色等级基础伤害起点", "INTEGER", calcPart("pyke_r", "RBaseDamage").mLevel1Value, "当前RBaseDamage一级起点250。", 30),
  fixed("r_breakpoint_1_level", "涌泉之恨角色等级断点1", "INTEGER", calcPart("pyke_r", "RBaseDamage").mBreakpoints[0].mLevel, "当前角色等级断点7级。", 40),
  fixed("r_breakpoint_1_bonus_per_level", "涌泉之恨断点1每级增加", "INTEGER", calcPart("pyke_r", "RBaseDamage").mBreakpoints[0].mBonusPerLevelAtAndAfter, "当前7级后原树斜率40；只保存原始断点。", 50),
  fixed("r_breakpoint_2_level", "涌泉之恨角色等级断点2", "INTEGER", calcPart("pyke_r", "RBaseDamage").mBreakpoints[1].mLevel, "当前角色等级断点10级。", 60),
  fixed("r_breakpoint_2_bonus_per_level", "涌泉之恨断点2每级增加", "INTEGER", calcPart("pyke_r", "RBaseDamage").mBreakpoints[1].mBonusPerLevelAtAndAfter, "当前10级后原树斜率30。", 70),
  fixed("r_breakpoint_3_level", "涌泉之恨角色等级断点3", "INTEGER", calcPart("pyke_r", "RBaseDamage").mBreakpoints[2].mLevel, "当前角色等级断点12级。", 80),
  fixed("r_breakpoint_3_bonus_per_level", "涌泉之恨断点3每级增加", "INTEGER", calcPart("pyke_r", "RBaseDamage").mBreakpoints[2].mBonusPerLevelAtAndAfter, "当前12级后原树斜率20。", 90),
  fixed("r_breakpoint_4_level", "涌泉之恨角色等级断点4", "INTEGER", calcPart("pyke_r", "RBaseDamage").mBreakpoints[3].mLevel, "当前角色等级断点17级。", 100),
  fixed("r_breakpoint_4_bonus_per_level", "涌泉之恨断点4每级增加", "INTEGER", calcPart("pyke_r", "RBaseDamage").mBreakpoints[3].mBonusPerLevelAtAndAfter, "当前17级后原树斜率10。", 110),
  runtime("r_base_damage_at_character_level", "涌泉之恨角色等级基础伤害实际值", "DECIMAL", "当前RBaseDamage是断点斜率树；中间曲线和角色等级求值由运行层外供，无默认。", 120),
  fixed("bonus_ad_ratio", "涌泉之恨额外攻击力伤害比例", "DECIMAL", coefficient("pyke_r", "RDamage", 1), "当前RDamage第二项mStat2带formula2，按来源额外攻击力读取。", 130),
  fixed("lethality_ratio", "涌泉之恨穿甲伤害比例", "DECIMAL", coefficient("pyke_r", "RDamage", 2), "当前RDamage第三项为mStat29×1.5，保留无默认穿甲点输入。", 140),
  runtime("lethality_points_input", "涌泉之恨固定穿甲点数输入", "DECIMAL", "当前RDamage消费mStat29；实际穿甲点数由运行层提供，无默认。", 150),
], [
  formula("execute_threshold_damage", "涌泉之恨单一敌人斩杀阈值", add(add(P("r_base_damage_at_character_level"), mul(P("bonus_ad_ratio"), AD_BONUS())), mul(P("lethality_ratio"), P("lethality_points_input"))), "当前RDamage=角色等级基础值+0.8×来源额外攻击力+1.5×mStat29；基础值不按未证曲线猜测。", 10),
  formula("reduced_damage", "涌泉之恨未斩杀单一敌人物理伤害", mul(P("reduced_damage_ratio"), add(add(P("r_base_damage_at_character_level"), mul(P("bonus_ad_ratio"), AD_BONUS())), mul(P("lethality_ratio"), P("lethality_points_input")))), "当前ReducedDamageFinal=ReducedDamage×完整RDamage，不能只乘基础伤害。", 20),
], [manaCostEffect("pyke_r")], [
  { item: "额外敌人执行与分享金币", reason: "额外目标和友方经济分支超出本批唯一当前敌人/自身收益范围。" },
  { item: "DamageCap=0.5", reason: "当前正文与ReducedDamageFinal树消费ReducedDamage，未见DamageCap当前消费者，不把旧值写成公式。" },
], [
  { item: "角色等级基础阈值实际求值、闪烁和再次施放事件", reason: "断点和四个斜率已逐项保存，未证中间算法和事件时序不猜。" },
], "派克R保留RDamage完整三项和未斩杀整个阈值的一半；角色等级基础值无默认，避免把断点斜率误作线性固定表。", { execute_threshold_damage: ["RDamage", "RBaseDamage"], reduced_damage: ["ReducedDamageFinal"] });

// 崔斯特P
put("twistedfate_p", [], [], [], [
  { item: "灌铅骰子金币收益与模式动态文本", reason: "纯经济收益，不属于本批战斗数值范围。" },
], [], "崔斯特P只有击杀后的额外金币，按范围约定整槽排除。", {});

// 崔斯特Q
put("twistedfate_q", [
  skillLevels("base_damage", "万能牌基础魔法伤害", "INTEGER", levels("twistedfate_q", "BaseDamage", 5), "当前DataValues.BaseDamage技能等级1至5为60/105/150/195/240；索引0的15不是一级。", 10),
  fixed("bonus_ad_ratio", "万能牌额外攻击力伤害比例", "DECIMAL", at("twistedfate_q", "BonusADRatio"), "当前TotalDamage的mStat2带formula2，按来源额外攻击力读取。", 20),
  fixed("ap_ratio", "万能牌法强伤害比例", "DECIMAL", at("twistedfate_q", "APRatio"), "当前TotalDamage消费APRatio×来源总法强。", 30),
  fixed("cast_time_ms", "万能牌施法时间（毫秒）", "INTEGER", milliseconds(rawAt("twistedfate_q", "spellCastTime", 0)), "当前spellCastTime=0.25秒，转换为250毫秒。", 40),
], [formula("enemy_magic_damage", "万能牌单一敌人单张魔法伤害", add(add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), mul(P("ap_ratio"), AP())), "当前TotalDamage=BaseDamage+0.5×来源额外攻击力+0.85×来源总法强；同一敌人只受一张牌伤害，不乘3。", 10)], [manaCostEffect("twistedfate_q")], [
  { item: "同一敌人承受三张牌的三倍伤害", reason: "当前扩展正文明确同一敌人只会受到其中一张牌的伤害。" },
  { item: "扇形范围内额外敌人分配", reason: "本轮只保留当前唯一敌人伤害。" },
], [], "崔斯特Q取技能等级1起60并保留单一敌人一张牌的完整伤害组成；不把投掷三张牌当成同敌三次。", { enemy_magic_damage: ["TotalDamage"] });

// 崔斯特W
const cardBaseExpression = (baseKey, apKey) => add(add(P(baseKey), mul(P("total_ad_ratio"), AD_TOTAL())), mul(P(apKey), AP()));
const cardFullExpression = (baseKey, apKey, critKey) => {
  const base = cardBaseExpression(baseKey, apKey);
  return add(base, mul(mul(P("critical_effectiveness_input"), P(critKey)), base));
};
put("twistedfate_w", [
  skillLevels("blue_base_damage", "蓝牌基础魔法伤害", "INTEGER", levels("twistedfate_w", "BlueBase", 5), "当前BlueBase技能等级1至5为40/60/80/100/120。", 10),
  skillLevels("red_base_damage", "红牌基础魔法伤害", "INTEGER", levels("twistedfate_w", "RedBase", 5), "当前RedBase技能等级1至5为30/45/60/75/90。", 20),
  skillLevels("gold_base_damage", "金牌基础魔法伤害", "DECIMAL", levels("twistedfate_w", "GoldBase", 5), "当前GoldBase技能等级1至5为15/22.5/30/37.5/45；完整PickACard树已核实存在。", 30),
  fixed("total_ad_ratio", "选牌总攻击力比例", "DECIMAL", at("twistedfate_w", "ttAD"), "当前三种牌树均使用总攻击力×1。", 40),
  fixed("blue_ap_ratio", "蓝牌法强比例", "DECIMAL", at("twistedfate_w", "ttBlueAP"), "当前ttBlueAP=1。", 50),
  fixed("red_ap_ratio", "红牌法强比例", "DECIMAL", at("twistedfate_w", "ttRedAP"), "当前ttRedAP=0.7。", 60),
  fixed("gold_ap_ratio", "金牌法强比例", "DECIMAL", at("twistedfate_w", "ttGoldAP"), "当前ttGoldAP=0.5。", 70),
  fixed("blue_crit_multiplier", "蓝牌暴击效能比例", "DECIMAL", at("twistedfate_w", "BlueCritMultiplier"), "当前BlueCritMultiplier=0.575。", 80),
  fixed("red_crit_multiplier", "红牌暴击效能比例", "DECIMAL", at("twistedfate_w", "RedCritMultiplier"), "当前RedCritMultiplier=0.35。", 90),
  fixed("gold_crit_multiplier", "金牌暴击效能比例", "DECIMAL", at("twistedfate_w", "GoldCritMultiplier"), "当前GoldCritMultiplier=0.25；该值在完整当前PickACard对象中存在。", 100),
  runtime("critical_effectiveness_input", "选牌暴击效能实际输入", "DECIMAL", "BlueDamage/RedDamage/GoldDamage的mStat8子树无默认，实际暴击效能由运行层外供。", 110),
  skillLevels("blue_mana_restore", "蓝牌自身法力回复", "INTEGER", officialEffectLevels("twistedfate_w", 6, 5), "当前官方中文Effect[6]技能等级1至5为70/90/110/130/150，属于自身资源回复。", 120),
  skillLevels("red_slow_ratio", "红牌减速比例", "DECIMAL", officialEffectLevels("twistedfate_w", 2, 5, value => clean(value / 100)), "当前官方中文Effect[2]原值30/35/40/45/50为百分数点，按比例保存。", 130),
  fixed("red_slow_duration_ms", "红牌减速持续时间（毫秒）", "INTEGER", 2500, "当前正文直接写2.5秒。", 140),
  skillLevels("gold_stun_duration_ms", "金牌晕眩持续时间（毫秒）", "INTEGER", officialEffectLevels("twistedfate_w", 3, 5, milliseconds), "当前官方中文Effect[3]技能等级1至5为1/1.25/1.5/1.75/2秒。", 150),
  fixed("cast_time_ms", "选牌施法时间（毫秒）", "INTEGER", milliseconds(rawAt("twistedfate_w", "spellCastTime", 0)), "当前spellCastTime=0.425秒，转换为425毫秒。", 160),
], [
  formula("blue_card_damage", "蓝牌单一敌人完整暴击魔法伤害", cardFullExpression("blue_base_damage", "blue_ap_ratio", "blue_crit_multiplier"), "当前BlueDamage完整树=（BlueBase+总AD×1+法强×1）+暴击输入×0.575×同一完整基础段；不是只录未暴击基础树。", 10),
  formula("red_card_damage", "红牌单一敌人完整暴击魔法伤害", cardFullExpression("red_base_damage", "red_ap_ratio", "red_crit_multiplier"), "当前RedDamage完整树=（RedBase+总AD×1+法强×0.7）+暴击输入×0.35×同一完整基础段。", 20),
  formula("gold_card_damage", "金牌单一敌人完整暴击魔法伤害", cardFullExpression("gold_base_damage", "gold_ap_ratio", "gold_crit_multiplier"), "当前GoldDamage完整树=（GoldBase+总AD×1+法强×0.5）+暴击输入×0.25×同一完整基础段。", 30),
], [
  manaCostEffect("twistedfate_w"),
  manaRestoreEffect("blue_mana_restore", "蓝牌自身法力回复", "只在蓝牌触发时回复当前Effect6Amount；三牌互斥，实际选择事件待接。"),
], [
  { item: "红牌附近额外敌人伤害与减速分配", reason: "需要额外目标，本轮只保留当前唯一敌人牌伤害及自身蓝牌资源。" },
  { item: "把蓝红金三牌相加", reason: "三种牌互斥，当前每次选牌只应用一色。" },
], [
  { item: "mStat8暴击效能属性资格和选牌/下次攻击事件", reason: "完整暴击乘区已写入每色公式，实际输入和三牌选择时序待接。" },
], "崔斯特W保留蓝红金三套完整基础与暴击乘区；GoldBase与GoldCritMultiplier来自当前完整PickACard树，三牌互斥，蓝牌自身法力回复单列。", { blue_card_damage: ["BlueDamage", "ttBlueDamage"], red_card_damage: ["RedDamage", "ttRedDamage"], gold_card_damage: ["GoldDamage", "ttGoldDamage"] });

// 崔斯特E
put("twistedfate_e", [
  skillLevels("attack_speed_bonus_ratio", "卡牌骗术永久攻击速度比例", "DECIMAL", levels("twistedfate_e", "AttackSpeedBonus", 5, value => clean(value / 100)), "当前AttackSpeedBonus原值15/25/35/45/55为百分数点，转换为0.15至0.55；永久属性不挂临时持续时间。", 10),
  skillLevels("bonus_damage", "卡牌骗术第四次攻击基础魔法伤害", "INTEGER", levels("twistedfate_e", "Damage", 5), "当前Damage技能等级1至5为65/90/115/140/165；索引0的40不是一级。", 20),
  fixed("bonus_ad_ratio", "卡牌骗术额外攻击力伤害比例", "DECIMAL", at("twistedfate_e", "BonusADRatio"), "当前BonusDamage的mStat2带formula2，按来源额外攻击力读取。", 30),
  fixed("ap_ratio", "卡牌骗术法强伤害比例", "DECIMAL", at("twistedfate_e", "APRatio"), "当前BonusDamage消费APRatio×来源总法强。", 40),
  fixed("fourth_attack_count", "卡牌骗术触发攻击次数", "INTEGER", 4, "当前正文明确每第4次攻击触发额外伤害。", 50),
  fixed("tower_effectiveness_ratio", "卡牌骗术建筑效能比例", "DECIMAL", at("twistedfate_e", "TowerEffectiveness"), "当前建筑效能0.5；建筑目标分支不进入本轮唯一英雄目标公式。", 60),
], [formula("fourth_attack_magic_damage", "卡牌骗术第四次攻击单一敌人魔法伤害", add(add(P("bonus_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), mul(P("ap_ratio"), AP())), "当前BonusDamage=Damage+0.2×来源额外攻击力+0.4×来源总法强；触发次数由事件层接线。", 10)], [attributeEffect("permanent_attack_speed", "卡牌骗术自身永久攻击速度", parameterValue("attack_speed_bonus_ratio"), "bonus_attack_speed_percent", persistentLifecycle(), "当前正文明确永久攻击速度增益；不创建临时持续时间或自动攻击事件。", 20)], [
  { item: "建筑物伤害折半", reason: "仅英雄当前敌人路径进入本批；建筑分支保留TowerEffectiveness来源说明但不生成结果。" },
], [
  { item: "每第4次攻击的计数、命中和触发", reason: "数值与永久攻速属性已保留，攻击计数事件待接。" },
], "崔斯特E保留永久攻击速度属性和第四次攻击额外伤害；建筑效能仅作范围外来源记录。", { fourth_attack_magic_damage: ["BonusDamage"] });

// 崔斯特R
put("twistedfate_r", [
  skillLevels("cooldown_ms", "命运基础冷却时间（毫秒）", "INTEGER", rawLevels("twistedfate_r", "cooldownTime", 3, milliseconds), "当前Destiny客户端冷却技能等级1至3为170/140/110秒；本技能不在28项公共复用清单中。", 10),
  fixed("mana_cost", "命运基础法力消耗", "INTEGER", 100, "当前根负责人按客户端与官方16.17.1核对为100；不采用后续数组噪声115/130/0。", 20),
  skillLevels("recast_window_ms", "命运再次施放窗口（毫秒）", "INTEGER", levels("twistedfate_r", "RecastDuration", 3, milliseconds), "当前RecastDuration技能等级1至3为6/8/10秒。", 30),
  fixed("teleport_distance", "命运传送距离", "INTEGER", rawAt("twistedfate_r", "castRange", 1), "当前castRange=5500；传送是自身位移，不能随纯视野整槽排除。", 40),
  fixed("teleport_channel_duration_ms", "命运传送引导时间（毫秒）", "INTEGER", 1500, "当前概要明确传送引导1.5秒；与首次施法250毫秒分开。", 50),
  fixed("cast_time_ms", "命运首次施法时间（毫秒）", "INTEGER", milliseconds(rawAt("twistedfate_r", "spellCastTime", 0)), "当前spellCastTime=0.25秒，转换为250毫秒。", 60),
], [], [manaCostEffect("twistedfate_r", "本技能法力为本批新增公共参数；真实消耗时点与施法资格由后续事件层接线。")], [
  { item: "全图敌方英雄真实视野和显形", reason: "纯视野收益，按范围约定排除；自身传送保留。" },
], [
  { item: "再次施放、1.5秒引导和限制效果打断", reason: "保留传送距离、窗口和引导参数，状态与事件时序待接。" },
], "崔斯特R仅保留自身传送和明确冷却、法力、窗口、距离、引导数值；纯全图视野排除。", {});

// 生成前静态校验，避免把结构错误带入请求计划。
const walk = (dir, output = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, output);
    else output.push(file);
  }
  return output;
};
const sourceManifest = walk(INPUT).sort().map(file => {
  const relative = path.relative(INPUT, file).split(path.sep).join("/");
  return { path: relative, sha256: fileSha(relative), byteSize: fs.statSync(file).size };
});
const declared = new Map((inputVersion.sourceFiles || []).map(file => [file.path, file]));
const inputIntegrity = sourceManifest.map(file => {
  const expected = declared.get(file.path);
  return { path: file.path, actualSha256: file.sha256, actualByteSize: file.byteSize,
    declaredSha256: expected?.sha256 ?? null, declaredByteSize: expected?.byteSize ?? null,
    declaredMatch: expected ? expected.sha256 === file.sha256 && expected.byteSize === file.byteSize : null };
});
if (inputIntegrity.some(item => item.declaredMatch === false)) throw new Error("输入包完整性失败");
const reusedKeys = new Set(reuse.map(item => item.skillKey + "/" + item.parameterKey));
const inspectExpression = (node, skillKey, where) => {
  if (!node || typeof node !== "object") throw new Error(where + "表达式节点为空");
  if (node.nodeType === "PARAMETER") {
    const local = writes[skillKey]?.parameters.some(item => item.parameterKey === node.parameterKey);
    if (!local && !reusedKeys.has(skillKey + "/" + node.parameterKey)) throw new Error(where + "引用未声明参数 " + node.parameterKey);
    return;
  }
  if (node.nodeType === "ATTRIBUTE") return;
  if (node.nodeType !== "OPERATION" || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(where + "不是恰好二元运算");
  inspectExpression(node.operands[0], skillKey, where + ".左");
  inspectExpression(node.operands[1], skillKey, where + ".右");
};
for (const skillKey of order) {
  const write = writes[skillKey];
  if (!write) throw new Error("技能未写入定义 " + skillKey);
  const parameterKeys = new Set();
  for (const item of write.parameters) {
    if (parameterKeys.has(item.parameterKey)) throw new Error(skillKey + "参数键重复 " + item.parameterKey);
    parameterKeys.add(item.parameterKey);
    if (!["FIXED", "SKILL_LEVEL", "RUNTIME_INPUT"].includes(item.valueMode)) throw new Error(skillKey + "参数模式错误 " + item.parameterKey);
    if (item.valueMode === "RUNTIME_INPUT" && (item.fixedValue !== null || item.levelValues !== null)) throw new Error(skillKey + "运行输入带默认值 " + item.parameterKey);
    const values = item.valueMode === "FIXED" ? [item.fixedValue] : item.valueMode === "SKILL_LEVEL" ? Object.values(item.levelValues || {}) : [];
    if (values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error(skillKey + "数值非法 " + item.parameterKey);
    if (item.parameterKey.endsWith("_ms") && item.valueType !== "INTEGER") throw new Error(skillKey + "毫秒字段不是整数 " + item.parameterKey);
    if (item.parameterKey.endsWith("_ms") && values.some(value => !Number.isInteger(value))) throw new Error(skillKey + "毫秒值不是整数 " + item.parameterKey);
  }
  for (const item of write.formulas) inspectExpression(item.expression, skillKey, skillKey + "/" + item.formulaKey);
  for (const item of write.effects) {
    for (const result of item.results || []) {
      if (!Object.prototype.hasOwnProperty.call(result, "spellShieldBlockScope") || result.spellShieldBlockScope !== null) throw new Error(skillKey + "/" + item.effectKey + "缺少spellShieldBlockScope:null");
    }
    if (item.lifecycle?.durationValue?.kind === "PARAMETER" && !parameterKeys.has(item.lifecycle.durationValue.parameterKey)) throw new Error(skillKey + "/" + item.effectKey + "生命周期引用未声明参数");
  }
}

const skills = {};
for (const skillKey of order) {
  const { hero } = bound(skillKey);
  const sourceSkill = hero.source.skills.find(item => item.slot === slotOf(skillKey));
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
      { type: "fixed-source-version", client: "16.17", official: "16.17.1", build: BUILD },
    ],
    proofNote: notes[skillKey],
  };
}
const protectedSubjects = order.map(skillKey => ({ skillKey, subject: snapshot.summary?.[skillKey]?.subject || null, source: "输入包/参考资料/当前20槽保护快照.json" }));
const currentCompositionLists = Object.fromEntries(order.map(skillKey => [skillKey, snapshot.summary?.[skillKey]?.components || null]));
const protectedObjects = {
  subjects: protectedSubjects,
  currentCompositionLists,
  reusedPublicParameters: reuse,
  protectedReferenceRequests: snapshot.requests || [],
  protectedReferenceRoutes: [...new Set((snapshot.requests || []).map(request => request.route))],
  protectedReferenceCounts: { GETs: snapshot.GETs, subjects: 20, currentCompositionSkillSlots: 20, currentCompositionLists: 120, reusedPublicParameters: reuse.length, images: 20, characters: 4, characterSkillRelations: 4, dictionaries: 4 },
  scope: "只保护既有20个技能主体、六类组成、28项公共参数、四个角色、角色关系、代表图和四类字典；本批不更新既有对象。",
  snapshotFile: "输入包/参考资料/当前20槽保护快照.json",
  snapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
};
const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const routeByKind = { parameters: "parameters", formulas: "formulas", effects: "effects", processes: "processes", internalStates: "internal-states", triggerRules: "trigger-rules" };
const keyByKind = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" };
const allWrites = order.flatMap(skillKey => kinds.flatMap(kind => (writes[skillKey][kind] || []).map(body => ({ skillKey, kind, body }))));
const requestCounts = Object.fromEntries(kinds.map(kind => [kind, allWrites.filter(item => item.kind === kind).length]));
const newTotal = Object.values(requestCounts).reduce((sum, count) => sum + count, 0);
const reusedPublicParameters = reuse.map(item => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false }));
const meta = {
  generatedAt: new Date().toISOString(), batch: BATCH, status: "候选已生成，等待主负责人审查；未调用业务接口",
  gameId: "lol", apiBase: API_BASE, sourceVersion,
  scope: "赛娜、锤石、派克、崔斯特20个技能槽；只新增当前根绑定正文消费且来源明确的参数、实际二元公式和自身持续属性/护盾/资源效果。既有20个主体、120项六类组成、28项公共参数、角色关系、图片和字典全部保护；第三友方、额外敌人、兵野专用、纯视野、纯经济和无当前消费者旧树排除。",
  sourcePolicy: "固定客户端16.17、官方16.17.1和构建16.17.8104348；沿当前根绑定正文与实际消费树。未知等级曲线、属性枚举、目标资格、施法时序和运行输入不猜、不设默认；百分数点与比例按正文和计算树分别保存。",
  inputPackage: "输入包/", currentSnapshot: "输入包/参考资料/当前20槽保护快照.json",
  currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"), sourceIndexSha256: inputVersion.sourceIndexSha256,
  businessWrites: 0, apiCalls: 0, tokenStored: false, candidateFileSha256: null,
};
const candidate = {
  meta, skills, order, reusedPublicParameters, reusedExistingParameters: reusedPublicParameters,
  counts: {
    newParameters: requestCounts.parameters, newFormulas: requestCounts.formulas, newEffects: requestCounts.effects,
    newProcesses: requestCounts.processes, newInternalStates: requestCounts.internalStates, newTriggerRules: requestCounts.triggerRules,
    newTotal, reusedPublicParameters: reuse.length, plannedTotalIncludingReused: newTotal + reuse.length, protectedCurrentCompositionLists: 120,
  },
  apiWrites: 0, sourceFiles: sourceManifest,
  sourceNotes: {
    frozenInput: "输入包由主负责人冻结并按字节复制；源值来自根绑定当前正文和固定客户端/官方资料。",
    publicParameterReuse: "28项复用清单只表示既有对象保护，不复制到新增请求体；既有冷却和法力参数不重建。",
    selectorPolicy: "mStat2带formula2时按来源额外攻击力；无formula时仅在根核对给出窄口径时按总攻击力或额外攻击力；mStat8/mStat9/mStat29和角色等级基础值均无默认运行输入。",
    scopeBoundary: "只保留自身、唯一当前敌人、战前魂层与明确资源/属性；第三友方、额外敌人、兵野专用、纯视野/经济和无当前消费者旧树列入逐技能处置。",
    noBusinessWrites: true,
  },
  protectedObjects, revision: "hero40-source-v1",
};
writeJson("完整候选.json", candidate);
const candidateFileSha256 = sha(fs.readFileSync(path.join(ROOT, "完整候选.json")));
const requests = allWrites.map((item, index) => {
  const stableKey = item.body[keyByKind[item.kind]];
  return { sequence: index + 1, method: "POST", route: "/skills/" + item.skillKey + "/" + routeByKind[item.kind],
    detailRoute: "/skills/" + item.skillKey + "/" + routeByKind[item.kind] + "/" + stableKey,
    skillKey: item.skillKey, kind: item.kind, stableKey, status: "仅意图，未调用", body: item.body };
});
const plan = {
  generatedAt: new Date().toISOString(), status: "仅写入意图，未调用业务接口；候选等待审查", batch: BATCH, apiBase: API_BASE,
  sourceVersion, candidateFileSha256, currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
  sourceIndexSha256: inputVersion.sourceIndexSha256, requestCount: requests.length, requestCounts,
  currentTotalComponents: newTotal + reuse.length, currentCompositionListsProtected: 120, reusedPublicParameters,
  protectedSkills: order, protectedCounts: protectedObjects.protectedReferenceCounts, requests, noApiCalls: true,
};
writeJson("写前请求计划.json", plan);
const planFileSha256 = sha(fs.readFileSync(path.join(ROOT, "写前请求计划.json")));
const sourceValues = {
  generatedAt: new Date().toISOString(), batch: BATCH, sourceVersion, sourceIndexSha256: inputVersion.sourceIndexSha256,
  inputFileManifestSha256: sha(JSON.stringify(sourceManifest)),
  skills: Object.fromEntries(order.map(skillKey => [skillKey, {
    source: sourceFor(skillKey),
    intendedValues: writes[skillKey].parameters.map(item => ({ parameterKey: item.parameterKey, name: item.name, valueType: item.valueType, valueMode: item.valueMode, fixedValue: item.fixedValue, levelValues: item.levelValues })),
    formulaSources: writes[skillKey].formulas.map(item => ({ formulaKey: item.formulaKey, expression: item.expression, sourceCalculationNames: formulaSourceNames[skillKey]?.[item.formulaKey] || [] })),
    excluded: excluded[skillKey], pending: pending[skillKey],
  }])),
};
writeJson("源值解析.json", sourceValues);
writeJson("来源哈希汇总.json", {
  generatedAt: new Date().toISOString(), batch: BATCH, sourceVersion, sourceIndexSha256: inputVersion.sourceIndexSha256,
  inputFiles: sourceManifest, inputIntegrity, currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
  candidateFileSha256, planFileSha256,
  cursorReview: { path: "../hero40-cursor-review-run-20260910-retry1", verdict: "READY", auditSha256: "3f24f270de7a83590d5d0d6b4ad43a49eedc1ad6822d4a0c3705564a7ef41c07" },
});
writeJson("来源与范围.json", {
  batch: BATCH, status: "候选阶段，未调用业务接口", sourceVersion,
  included: [
    "赛娜：P魂层/额外普攻/当前生命伤害与自身移速，Q单一敌人伤害、自己治疗与减速，W当前敌人伤害与禁锢，E自身幽魂移速，R当前敌人伤害与自身护盾。",
    "锤石：P魂层自身属性，Q当前敌人伤害/控制，W自身护盾，E被动最低/最高伤害与主动伤害/减速，R首墙伤害和剩余墙同敌减速。",
    "派克：P单敌伤害储存与上限/生命转攻击力，Q共同伤害和条件法力返还，W自身伪装/移速，E位移/伤害/晕眩，R完整斩杀阈值和未斩杀伤害。",
    "崔斯特：Q单一敌人单张伤害，W蓝红金三套完整暴击树与蓝牌回蓝，E永久攻速与第四次攻击伤害，R自身传送和新增冷却/法力。",
  ],
  excludedOrPending: [
    "第三友方、额外敌人、兵野专用伤害/治疗、纯视野、纯经济和无当前消费者旧树排除。",
    "未知等级插值、mStat属性资格、施法字段冲突、目标/事件资格、资源扣除和周期/计数时序保持待接；无默认运行输入。",
  ],
  perSkillExcluded: excluded, perSkillPending: pending,
});
writeJson("候选版本.json", {
  batch: BATCH, revision: candidate.revision, generatedAt: new Date().toISOString(), status: "candidate",
  candidateFileSha256, planFileSha256, sourceIndexSha256: inputVersion.sourceIndexSha256,
  currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"), counts: candidate.counts, requestCounts, apiWrites: 0,
});
writeJson("冻结候选锁.json", {
  batch: BATCH, revision: candidate.revision, status: "候选已冻结，等待主负责人审查；未调用业务接口",
  candidateFileSha256, planFileSha256, sourceIndexSha256: inputVersion.sourceIndexSha256,
  currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"), requestCount: requests.length, requestCounts,
  protectedCounts: protectedObjects.protectedReferenceCounts, apiWrites: 0, noApiCalls: true, lockType: "静态哈希锁；不代表业务数据库已写入",
});
writeJson("候选交付索引.json", {
  batch: BATCH, revision: candidate.revision, status: "候选交付，未录入业务数据",
  files: ["完整候选.json", "写前请求计划.json", "源值解析.json", "来源哈希汇总.json", "来源与范围.json", "候选版本.json", "冻结候选锁.json", "体验报告.md", "独立源值数学.mjs", "独立源值数学报告.json"],
  candidateFileSha256, planFileSha256, counts: candidate.counts, requestCount: requests.length, apiWrites: 0,
  protectedCounts: protectedObjects.protectedReferenceCounts,
});
writeText("README.md", [
  "# 第四十批候选", "",
  "本目录保存赛娜、锤石、派克、崔斯特20个技能槽的静态候选和冻结输入副本。", "",
  "当前状态：候选阶段，未调用业务接口，业务写入数为0。源版本固定为客户端16.17、官方资料16.17.1、构建16.17.8104348。", "",
  "已有20个技能主体、120项六类组成、28项公共参数、角色关系、图片和字典由输入快照完整保护；本批只新增当前根绑定正文消费的参数、实际二元公式及明确自身属性、护盾或资源效果。", "",
  "赛娜Q/R、锤石W/R、派克E/R和崔斯特Q/W均保留正确的技能等级起点；派克W百分数点先换算为移动速度比例，锤石E施法小数保留，崔斯特W三色完整暴击子树保留。", "",
  "请先阅读完整候选、写前请求计划、来源与范围和独立源值数学报告；本批文件不构成真实数据库、运行时或页面验收证据。", "",
].join("\n"));
writeText("体验报告.md", [
  "# 第四十批体验与缺口", "",
  "候选阶段未写入业务数据，体验记录只描述后续页面接入需要核对的行为。", "",
  "- 赛娜：Q自身治疗、W延迟禁锢、E附近敌人条件和R自身护盾应分栏；P的魂层、当前生命曲线和移速偷取不能互相替代。", 
  "- 锤石：W自身护盾与灯笼持续时间分开；E满蓄最低/最高被动和主动伤害分开；R首墙与同一敌人的剩余墙减速分开。", 
  "- 派克：P灰色生命回复与储存上限分开；Q秒放/长蓄共用一条伤害；W移速衰减、E残影返回和R斩杀阈值等级曲线不能自动补零。", 
  "- 崔斯特：W蓝红金互斥且每色完整暴击树；E永久攻速与第四次攻击事件分开；R自身传送与全图视野分开。", "",
  "待补输入：目标和事件资格、额外目标/兵野支路、角色等级插值、mStat属性枚举、施法字段冲突、资源扣除、状态结束、周期和攻击计数。独立数学脚本从原始当前树构造期望，从候选参数与表达式求实际值，并检查双场景、缺值、整数毫秒和边界。", "",
].join("\n"));
const outputFiles = ["完整候选.json", "写前请求计划.json", "源值解析.json", "来源哈希汇总.json", "来源与范围.json", "候选版本.json", "冻结候选锁.json", "候选交付索引.json", "README.md", "体验报告.md"];
const fileManifest = outputFiles.map(file => ({ path: file, sha256: sha(fs.readFileSync(path.join(ROOT, file))), byteSize: fs.statSync(path.join(ROOT, file)).size }));
writeJson("文件散列.json", { generatedAt: new Date().toISOString(), batch: BATCH, status: "候选静态文件冻结；未调用业务接口", files: fileManifest, candidateFileSha256, planFileSha256, apiWrites: 0, noApiCalls: true });

const workspace = path.resolve(ROOT, "../../..");
const batchDir = path.join(workspace, "数据参考", "全量录入-2026-09", "交叉试录", "Luna", "英雄机制第四十批");
fs.mkdirSync(batchDir, { recursive: true });
fs.writeFileSync(path.join(batchDir, "README.md"), [
  "# 第四十批候选交接", "",
  "赛娜、锤石、派克、崔斯特20个技能槽的静态候选已生成，固定客户端16.17、官方资料16.17.1和构建16.17.8104348。", "",
  "当前阶段只完成源值绑定、候选与数学预检，未调用业务接口，业务写入数为0。完整材料位于 .agents/artifacts/hero40-luna-candidate/；主负责人负责来源复核、实际保存和页面验收。", "",
].join("\n"), "utf8");
console.log(JSON.stringify({ candidateFileSha256, planFileSha256, requestCount: requests.length, requestCounts, counts: candidate.counts, protectedCounts: protectedObjects.protectedReferenceCounts }, null, 2));
