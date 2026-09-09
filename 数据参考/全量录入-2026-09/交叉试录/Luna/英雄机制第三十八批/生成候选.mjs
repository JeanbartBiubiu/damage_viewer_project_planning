import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero38-root-entry-20260910");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十八批");
const batch = "第三十八批嘉文四世李青斯卡纳凯尔";
const revision = "hero38-source-v1-candidate";
const apiBase = "http://127.0.0.1:8080/api/admin/games/lol";

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const sha256File = file => sha256(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const clean = value => typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(8)) : value;
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
};
const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
};
const assert = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : `：${JSON.stringify(detail)}`));
};
const close = (a, b, tolerance = 1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const ms = seconds => {
  const value = Number(seconds) * 1000;
  const rounded = Math.round(value);
  assert(Math.abs(value - rounded) <= 0.001, "秒转毫秒不是整数", seconds);
  return rounded;
};

const inputVersionPath = path.join(inputDir, "输入版本.json");
const bindingPath = path.join(inputDir, "来源绑定与当前文本.json");
const snapshotPath = path.join(inputDir, "参考资料/当前20槽保护快照.json");
const reusePath = path.join(inputDir, "参考资料/公共参数复用清单.json");
const attributeBoundaryPath = path.join(inputDir, "参考资料/属性默认与边界.json");
const payloadSamplePath = path.join(inputDir, "参考资料/接口载荷样例.json");
const reviewPath = path.join(repo, ".agents/artifacts/hero38-cursor-review-run-20260910/review.md");
const reviewAuditPath = path.join(repo, ".agents/artifacts/hero38-cursor-review-run-20260910/主负责人执行审计.json");
const reviewManifestPath = path.join(repo, ".agents/artifacts/hero38-cursor-review-20260910/输入冻结散列.json");

const inputVersion = readJson(inputVersionPath);
const binding = readJson(bindingPath);
const snapshot = readJson(snapshotPath);
const reuse = readJson(reusePath);
const attributeBoundary = readJson(attributeBoundaryPath);
const payloadSample = readJson(payloadSamplePath);
const reviewAudit = readJson(reviewAuditPath);
const reviewText = fs.readFileSync(reviewPath, "utf8");
const reviewManifest = readJson(reviewManifestPath);

assert(inputVersion.batch === "第三十八批嘉文四世李青斯卡纳凯尔", "输入批次不符", inputVersion.batch);
assert(inputVersion.GETs === 197 && inputVersion.reusedParameters === 25 && inputVersion.apiWrites === 0, "输入版本计数不符", inputVersion);
assert(snapshot.GETs === 197 && (snapshot.apiWrites ?? 0) === 0 && (snapshot.businessWrites ?? 0) === 0, "保护快照不是只读197 GET", snapshot);
assert(Array.isArray(reuse) && reuse.length === 25, "公共参数复用数量不符", reuse.length);
assert(reviewAudit.verdict === "READY" && reviewAudit.reviewRevision === "hero38-source-v1" && reviewText.includes("result: finished"), "Cursor来源评审未READY");
assert(reviewAudit.readonlyAuditPassed === true && reviewAudit.apiWrites === 0 && reviewAudit.gitDelta.length === 0, "Cursor只读审计不通过", reviewAudit);
assert(payloadSample.apiFields?.parameter?.includes("parameterKey") && payloadSample.apiFields?.formula?.includes("expression"), "载荷样例字段缺失");
assert(Array.isArray(attributeBoundary.attributes) || typeof attributeBoundary === "object", "属性边界资料缺失");

const heroById = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const heroIds = {
  jarvaniv: "JarvanIV",
  leesin: "LeeSin",
  skarner: "Skarner",
  kayle: "Kayle",
};
const order = [
  "jarvaniv_p", "jarvaniv_q", "jarvaniv_w", "jarvaniv_e", "jarvaniv_r",
  "leesin_p", "leesin_q", "leesin_w", "leesin_e", "leesin_r",
  "skarner_p", "skarner_q", "skarner_w", "skarner_e", "skarner_r",
  "kayle_p", "kayle_q", "kayle_w", "kayle_e", "kayle_r",
];
const slotOf = skillKey => skillKey.split("_").at(-1).toUpperCase();
const heroOf = skillKey => heroIds[skillKey.split("_")[0]];
const bound = skillKey => {
  const hero = heroById[heroOf(skillKey)];
  const skill = hero?.skills.find(item => item.skillKey === skillKey);
  assert(hero && skill, "来源绑定技能缺失", skillKey);
  return { hero, skill, raw: skill.object.mSpell };
};
const sourceSummary = skillKey => {
  const { hero } = bound(skillKey);
  return hero.source.skills.find(item => item.slot === slotOf(skillKey));
};
const maxLevel = skillKey => sourceSummary(skillKey).officialMaxRank;
const dataItem = (skillKey, name) => {
  const item = bound(skillKey).raw.DataValues?.find(value => value.name === name);
  assert(item && Array.isArray(item.values), "DataValues缺失", { skillKey, name });
  return item;
};
const dataValues = (skillKey, name) => dataItem(skillKey, name).values;
const pick = (skillKey, name, start, count, transform = clean) => {
  const values = dataValues(skillKey, name).slice(start, start + count);
  assert(values.length === count && values.every(value => typeof value === "number" && Number.isFinite(value)), "来源等级数组不足", { skillKey, name, start, count, values });
  return values.map(transform);
};
const scalar = (skillKey, name, index = 0, transform = clean) => {
  const value = dataValues(skillKey, name)[index];
  assert(typeof value === "number" && Number.isFinite(value), "来源标量缺失", { skillKey, name, index, value });
  return transform(value);
};
const effectValues = (skillKey, effectIndex) => {
  const value = bound(skillKey).raw.mEffectAmount?.[effectIndex]?.value;
  assert(Array.isArray(value), "效果数组缺失", { skillKey, effectIndex });
  return value;
};
const pickEffect = (skillKey, effectIndex, start, count, transform = clean) => {
  const values = effectValues(skillKey, effectIndex).slice(start, start + count);
  assert(values.length === count && values.every(value => typeof value === "number" && Number.isFinite(value)), "效果等级数组不足", { skillKey, effectIndex, start, count, values });
  return values.map(transform);
};
const effectScalar = (skillKey, effectIndex, index = 0, transform = clean) => {
  const value = effectValues(skillKey, effectIndex)[index];
  assert(typeof value === "number" && Number.isFinite(value), "效果标量缺失", { skillKey, effectIndex, index, value });
  return transform(value);
};
const calculation = (skillKey, name) => {
  const value = bound(skillKey).raw.mSpellCalculations?.[name];
  assert(value, "计算树缺失", { skillKey, name });
  return value;
};
const calcPart = (skillKey, name, index = 0) => {
  const part = calculation(skillKey, name).mFormulaParts?.[index];
  assert(part, "计算树子项缺失", { skillKey, name, index });
  return part;
};
const coefficient = (skillKey, name, index = 0) => {
  const part = calcPart(skillKey, name, index);
  assert(typeof part.mCoefficient === "number" && Number.isFinite(part.mCoefficient), "计算树系数缺失", { skillKey, name, index, part });
  return clean(part.mCoefficient);
};
const multiplierNumber = (skillKey, name) => {
  const value = calculation(skillKey, name).mMultiplier?.mNumber;
  assert(typeof value === "number" && Number.isFinite(value), "计算树倍率缺失", { skillKey, name, value });
  return clean(value);
};
const rootField = (skillKey, name) => bound(skillKey).raw[name];
const rootMs = (skillKey, name = "spellCastTime") => {
  const value = rootField(skillKey, name);
  assert(typeof value === "number" && Number.isFinite(value), "根时间字段缺失", { skillKey, name, value });
  return ms(value);
};

const parameter = (parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder) => ({
  parameterKey,
  name,
  valueType,
  valueMode,
  fixedValue: fixedValue ?? null,
  levelValues: levelValues ? Object.fromEntries(levelValues.map((value, index) => [String(index + 1), clean(value)])) : null,
  description,
  sortOrder,
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
const HP_TOTAL = () => A("SOURCE", "hp", "TOTAL");
const HP_BONUS = () => A("SOURCE", "hp", "BONUS");
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });

const valueRule = value => ({ value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const persistentBehavior = () => ({
  moment: "PERSISTENT",
  valueReadMode: "APPLICATION_SNAPSHOT",
  stackValueMode: "SHARED",
  reapplicationValueMode: "REPLACE",
  periodicExecutionMode: null,
});
const timedLifecycle = durationParameterKey => ({
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
const persistentLifecycle = () => ({
  durationValue: null,
  maxStacksValue: { kind: "FIXED", value: 1 },
  applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope: "SOURCE",
  reapplicationStackMode: "KEEP",
  reapplicationDurationMode: null,
  expiryMode: "EXPLICIT_ONLY",
  periodicIntervalValue: null,
  firstPeriodicExecution: null,
});
const resourceEffect = (effectKey, name, parameterKey, attributeKey, description, sortOrder) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: null,
  results: [{
    resultKey: "consume_resource",
    name,
    resultType: "RESOURCE_CHANGE",
    target: "SOURCE",
    description: "只记录当前基础资源消耗；实际扣除时点和施放资格由后续事件接线。",
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: valueRule({ kind: "PARAMETER", parameterKey }),
    detail: { attributeKey, operation: "CONSUME" },
  }],
});
const attributeEffect = (effectKey, name, value, attributeKey, durationKey, description, sortOrder, lifecycle = null) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: lifecycle || timedLifecycle(durationKey),
  results: [{
    resultKey: "attribute",
    name,
    resultType: "ATTRIBUTE_CHANGE",
    target: "SOURCE",
    description: "只定义当前正文明确的自身属性变化；触发事件由后续事件层接线。",
    sortOrder: 10,
    lifecycleBehavior: persistentBehavior(),
    spellShieldBlockScope: null,
    valueRule: valueRule(value),
    detail: { attributeKey, operation: "INCREASE", modifierZoneKey: "attribute_flat_add" },
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
    description: "只定义当前正文明确的自身普通护盾数值；触发和移除事件由后续事件层接线。",
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
const formulaSources = {};
const put = (skillKey, parameters, formulas, effects, excludedItems, pendingItems, note, sourceNames = {}) => {
  writes[skillKey] = { parameters, formulas, effects, processes: [], internalStates: [], triggerRules: [] };
  excluded[skillKey] = excludedItems;
  pending[skillKey] = pendingItems;
  formulaSources[skillKey] = sourceNames;
  writes[skillKey].parameters.forEach(item => assert(!item.parameterKey.includes("undefined"), "参数键异常", item));
};
const manaEffect = (skillKey, sortOrder = 900) => resourceEffect("mana_cost", "施放法力消耗", "mana_cost", "mana", "沿用冻结公共参数mana_cost；不创建或覆盖公共参数。", sortOrder);
const energyEffect = (skillKey, sortOrder = 900) => resourceEffect("energy_cost", "施放能量消耗", "energy_cost", "energy", "李青使用能量资源；当前公共复用清单没有能量消耗，本候选新增意图仅记录基础消耗。", sortOrder);

// 嘉文四世
put("jarvaniv_p", [
  fixed("current_health_damage_ratio", "战争律动目标当前生命值伤害比例", "DECIMAL", scalar("jarvaniv_p", "TooltipCurrentHealthDamage"), "客户端当前根绑定TooltipCurrentHealthDamage取索引0；正文乘100后显示百分数。目标当前生命值和首次攻击触发由运行层提供。", 10),
  fixed("cadence_cooldown_base_seconds", "战争律动基础冷却（秒）", "DECIMAL", calcPart("jarvaniv_p", "TooltipCooldown").mLevel1Value, "当前TooltipCooldown是角色等级断点树，保留1级起点，不把断点曲线展开为技能等级。", 20),
  fixed("cadence_cooldown_breakpoint_1_level", "战争律动第一次冷却断点等级", "INTEGER", calcPart("jarvaniv_p", "TooltipCooldown").mBreakpoints[0].mLevel, "当前角色等级断点。", 30),
  fixed("cadence_cooldown_breakpoint_1_delta_seconds", "战争律动第一次冷却变化（秒）", "DECIMAL", calcPart("jarvaniv_p", "TooltipCooldown").mBreakpoints[0].mAdditionalBonusAtThisLevel, "当前6级起冷却变化为-1秒；保留来源有符号变化。", 40),
  fixed("cadence_cooldown_breakpoint_2_level", "战争律动第二次冷却断点等级", "INTEGER", calcPart("jarvaniv_p", "TooltipCooldown").mBreakpoints[1].mLevel, "当前角色等级断点。", 50),
  fixed("cadence_cooldown_breakpoint_2_delta_seconds", "战争律动第二次冷却变化（秒）", "DECIMAL", calcPart("jarvaniv_p", "TooltipCooldown").mBreakpoints[1].mAdditionalBonusAtThisLevel, "当前11级起冷却变化为-1秒。", 60),
  fixed("cadence_cooldown_breakpoint_3_level", "战争律动第三次冷却断点等级", "INTEGER", calcPart("jarvaniv_p", "TooltipCooldown").mBreakpoints[2].mLevel, "当前角色等级断点。", 70),
  fixed("cadence_cooldown_breakpoint_3_delta_seconds", "战争律动第三次冷却变化（秒）", "DECIMAL", calcPart("jarvaniv_p", "TooltipCooldown").mBreakpoints[2].mAdditionalBonusAtThisLevel, "当前16级起冷却变化为-1秒。", 80),
], [], [], [
  { item: "非英雄单位最低/最高伤害", reason: "仅在扩展正文出现，属于非英雄专用分支；本轮一对一敌方英雄不建立兵野分支。" },
], [
  { item: "目标当前生命值实际属性和首次攻击触发", reason: "当前绑定正文消费比例但计算树没有目标生命属性节点，保留比例并待运行事件接线。" },
  { item: "角色等级断点求值", reason: "保留起点、断点等级和变化量；没有证据把其展开为完整角色等级公式。" },
], "战争律动只保存当前生命值百分数和角色等级冷却断点；不把非英雄上限写入单一敌方英雄路径。", {});

put("jarvaniv_q", [
  skillLevels("base_damage", "巨龙撞击基础物理伤害", "INTEGER", pick("jarvaniv_q", "BaseDamage", 1, 5), "客户端当前根绑定DataValues.BaseDamage取技能等级索引1至5；索引0的50不是1级候选值。", 10),
  fixed("bonus_ad_ratio", "巨龙撞击额外攻击力比例", "DECIMAL", coefficient("jarvaniv_q", "TotalDamage", 1), "TotalDamage的mStat=2、mStatFormula=2，按同版窄证读取来源额外攻击力。", 20),
  skillLevels("armor_shred_ratio", "巨龙撞击护甲削减比例", "DECIMAL", pick("jarvaniv_q", "BaseARShred", 1, 5), "正文将BaseARShred乘100后显示；保存0.10至0.26比例，不把显示百分数当整数点。", 30),
  fixed("armor_shred_duration_ms", "巨龙撞击护甲削减持续（毫秒）", "INTEGER", ms(effectScalar("jarvaniv_q", 2, 1)), "当前Effect3Amount取索引1为3秒，转换为3000毫秒。", 40),
  fixed("knock_up_duration_ms", "巨龙撞击连接军旗击飞持续（毫秒）", "INTEGER", 750, "当前绑定中文正文明确连接军旗时沿途敌人击飞0.75秒；只保存时长，不创建控制结果。", 50),
  fixed("cast_time_ms", "巨龙撞击根施法时间（毫秒）", "INTEGER", rootMs("jarvaniv_q"), "只记录根spellCastTime；不表示命中或击飞事件完成。", 60),
], [
  formula("physical_damage", "巨龙撞击单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前TotalDamage=BaseDamage+1.45×来源额外攻击力；沿途多个目标由事件层分别结算。", 10),
], [manaEffect("jarvaniv_q")], [
  { item: "E旗帜牵引/击飞的位移几何", reason: "属于与军旗连接的另一技能和空间事件，不并入Q伤害公式。" },
  { item: "SWIFTPLAY、BotData和模式覆盖树", reason: "不是当前标准根绑定正文。" },
], [
  { item: "目标资格、沿途多目标和与军旗连接", reason: "保留单一敌人伤害树；目标、击飞和连接事件待接。" },
], "巨龙撞击按DataValues索引1起保存伤害和护甲削减，计算树2/2选择器按额外攻击力读取。", { physical_damage: ["TotalDamage"] });

put("jarvaniv_w", [
  skillLevels("shield_base", "黄金圣盾基础护盾", "INTEGER", pickEffect("jarvaniv_w", 0, 1, 5), "当前TotalShield的mEffectIndex=1对应mEffectAmount[0]，取技能等级索引1至5为60/80/100/120/140。", 10),
  fixed("shield_bonus_ad_ratio", "黄金圣盾命中英雄额外护盾额外攻击力比例", "DECIMAL", coefficient("jarvaniv_w", "TotalShield", 1), "TotalShield第二项mStat=2、mStatFormula=2，读取来源额外攻击力。", 20),
  fixed("shield_bonus_stat12_ratio", "黄金圣盾命中英雄额外护盾生命比例", "DECIMAL", coefficient("jarvaniv_w", "BonusShield", 0), "BonusShield的mStat=12；结合同版窄证映射为来源生命总值，使用SOURCE.hp.TOTAL。", 30),
  skillLevels("slow_ratio", "黄金圣盾附近敌人减速比例", "DECIMAL", pick("jarvaniv_w", "BaseSlowAmount", 1, 5), "正文将BaseSlowAmount乘100后显示；保存0.15至0.35比例。", 40),
  fixed("slow_duration_ms", "黄金圣盾减速持续（毫秒）", "INTEGER", ms(effectScalar("jarvaniv_w", 4, 1)), "当前Effect5Amount取索引1为2秒，转换为2000毫秒。", 50),
  fixed("cast_time_ms", "黄金圣盾根施法时间（毫秒）", "INTEGER", rootMs("jarvaniv_w"), "只记录根spellCastTime。", 60),
], [
  formula("shield_value", "黄金圣盾自身基础护盾值", add(P("shield_base"), mul(P("shield_bonus_ad_ratio"), AD_BONUS())), "当前TotalShield=基础护盾+0.7×来源额外攻击力；每名敌方英雄的额外护盾另由BonusShield保留为独立公式。", 10),
  formula("bonus_shield_value", "黄金圣盾命中英雄额外护盾值", mul(P("shield_bonus_stat12_ratio"), HP_TOTAL()), "当前BonusShield=0.013×来源生命总值；mStat12映射依据同版窄证，目标命中事件待接。", 20),
], [
], [
  { item: "护盾持续时间4秒", reason: "Effect4Amount虽有4秒值，但当前绑定正文没有消费该字段；不把未消费字段当已证生命周期。" },
  { item: "额外敌人目标事件", reason: "本轮只保留数值，附近敌人资格和每名英雄应用由事件层接线。" },
], [
  { item: "护盾英雄资格和额外护盾叠加时点", reason: "保留TotalShield与BonusShield两棵树；当前正文目标资格和命中次数待接。" },
], "黄金圣盾把基础护盾、额外攻击力护盾、来源生命总值额外护盾和附近减速分开；未把未被正文消费的4秒字段写成护盾生命周期。", { shield_value: ["TotalShield"], bonus_shield_value: ["BonusShield"] });

put("jarvaniv_e", [
  fixed("dash_speed", "德邦军旗冲刺速度", "INTEGER", scalar("jarvaniv_e", "EDashSpeed"), "当前正文/数据值明确的空间移动参数；不接入伤害或发数公式。", 10),
  fixed("behind_flag_check_distance", "德邦军旗身后判定距离", "INTEGER", scalar("jarvaniv_e", "EBehindJarvanCheck"), "当前来源几何判定值，保留为资料参数。", 20),
  fixed("knock_up_radius", "德邦军旗击飞范围半径", "INTEGER", scalar("jarvaniv_e", "EKnockUpAoE", 1), "客户端数组索引1起为180；不把空间半径当伤害范围。", 30),
  skillLevels("self_attack_speed_ratio", "德邦军旗自身攻击速度比例", "DECIMAL", pick("jarvaniv_e", "PermanentAttackSpeed", 1, 5), "当前正文被动直接消费PermanentAttackSpeed并乘100显示；取技能等级索引1至5。", 40),
  skillLevels("ally_attack_speed_ratio", "德邦军旗附近友军攻击速度比例", "DECIMAL", pick("jarvaniv_e", "BaseAuraAS", 1, 5), "当前正文主动消费BaseAuraAS并乘100显示；本轮保留来源数值但不创建第三友方效果。", 50),
  fixed("ap_ratio", "德邦军旗法术强度比例", "DECIMAL", scalar("jarvaniv_e", "APRatio"), "TotalDamage的StatByNamedDataValue使用APRatio；同版窄证读取来源总法术强度。", 60),
  skillLevels("base_magic_damage", "德邦军旗基础魔法伤害", "INTEGER", pickEffect("jarvaniv_e", 1, 1, 5), "当前TotalDamage的mEffectIndex=2对应mEffectAmount[1]，取技能等级索引1至5为80/120/160/200/240。", 70),
  fixed("flag_duration_ms", "德邦军旗持续（毫秒）", "INTEGER", ms(effectScalar("jarvaniv_e", 3, 1)), "当前Effect4Amount取索引1为8秒；用于自身被动及旗帜期间来源说明。", 80),
  fixed("cast_time_ms", "德邦军旗根施法时间（毫秒）", "INTEGER", rootMs("jarvaniv_e"), "只记录根spellCastTime。", 90),
], [
  formula("magic_damage", "德邦军旗落点单一敌人魔法伤害", add(P("base_magic_damage"), mul(P("ap_ratio"), AP())), "当前TotalDamage=落点基础伤害+0.8×来源总法术强度；友军光环不并入伤害。", 10),
], [
  manaEffect("jarvaniv_e"),
  attributeEffect("self_attack_speed", "德邦军旗自身被动攻击速度", { kind: "PARAMETER", parameterKey: "self_attack_speed_ratio" }, "bonus_attack_speed_percent", null, "当前正文明确军旗被动给予自身攻击速度；该自身被动随技能/资格存在，不使用主动军旗8秒时长。", 20, persistentLifecycle()),
], [
  { item: "附近友军攻击速度效果", reason: "第三友方收益不属于唯一敌人一对一主路径；仅保留来源参数供后续定向接线。" },
  { item: "旗帜连接击飞事件", reason: "空间连接和控制事件未在本轮创建。" },
  { item: "cherry模式APRatio和BotData", reason: "标准根绑定正文不消费。" },
], [
  { item: "旗帜落地、自身被动应用和友军目标资格", reason: "保留数值与自身属性效果；触发、目标资格和控制时序待接。" },
], "德邦军旗保留自身被动攻击速度和落点伤害；BaseAuraAS只作来源记录，不在本轮建立第三友方结果。", { magic_damage: ["TotalDamage"] });

put("jarvaniv_r", [
  skillLevels("base_damage", "天崩地裂基础物理伤害", "INTEGER", pick("jarvaniv_r", "BaseDamage", 1, 3), "客户端当前根绑定DataValues.BaseDamage取技能等级索引1至3为200/325/450；不采用索引0旧值75或尾部占位。", 10),
  fixed("bonus_ad_ratio", "天崩地裂额外攻击力比例", "DECIMAL", coefficient("jarvaniv_r", "DamageCalc", 1), "DamageCalc的mStat=2、mStatFormula=2，按同版窄证读取来源额外攻击力。", 20),
  fixed("wall_duration_ms", "天崩地裂竞技场持续（毫秒）", "INTEGER", ms(scalar("jarvaniv_r", "WallDuration")), "当前WallDuration=3.5秒，转换为3500毫秒。", 30),
  fixed("cast_time_ms", "天崩地裂根施法时间（毫秒）", "INTEGER", rootMs("jarvaniv_r"), "只记录根spellCastTime。", 40),
], [
  formula("physical_damage", "天崩地裂选中敌人及落地物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前DamageCalc=BaseDamage+1.8×来源额外攻击力；主目标与附近额外目标的命中事件分开。", 10),
], [manaEffect("jarvaniv_r")], [
  { item: "附近额外敌人的独立命中", reason: "正文共用DamageCalc但额外目标事件不在本轮单一敌人公式内。" },
  { item: "竞技场倒塌再次施放", reason: "只保留墙体持续数值，不创建再次施放事件。" },
  { item: "冷却尾部8/5/0和索引0占位", reason: "根数组中非技能等级值，且冷却/法力已由公共参数保护。" },
], [
  { item: "选中敌方英雄资格和落地时序", reason: "保留单一主目标公式；目标标签、区域命中和再次施放待接。" },
], "天崩地裂只保留选中敌人主树和竞技场时长，严格使用BaseDamage索引1至3。", { physical_damage: ["DamageCalc"] });

// 李青
put("leesin_p", [
  fixed("empowered_attack_count", "疾风骤雨强化攻击次数", "INTEGER", 2, "当前正文明确一次技能后的下两次攻击获得效果。", 10),
  fixed("passive_attack_speed_percent_points", "疾风骤雨攻击速度百分数点", "INTEGER", scalar("leesin_p", "PassiveAS"), "当前正文直接接PassiveAS百分号；保存40百分数点。", 20),
  runtime("energy_return_at_character_level", "疾风骤雨第二次攻击当前等级能量回复", "DECIMAL", "EnergyReturn为角色等级断点树；运行层提供当前角色等级实际值，不将断点线性展开。", 30),
  fixed("energy_return_level1", "疾风骤雨能量回复1级起点", "INTEGER", calcPart("leesin_p", "EnergyReturn").mLevel1Value, "当前角色等级断点树起点10。", 40),
  fixed("energy_return_breakpoint_1_level", "疾风骤雨能量回复第一次断点等级", "INTEGER", calcPart("leesin_p", "EnergyReturn").mBreakpoints[0].mLevel, "当前角色等级断点。", 50),
  fixed("energy_return_breakpoint_1_increase", "疾风骤雨能量回复第一次增加", "INTEGER", calcPart("leesin_p", "EnergyReturn").mBreakpoints[0].mAdditionalBonusAtThisLevel, "当前7级增加5点。", 60),
  fixed("energy_return_breakpoint_2_level", "疾风骤雨能量回复第二次断点等级", "INTEGER", calcPart("leesin_p", "EnergyReturn").mBreakpoints[1].mLevel, "当前角色等级断点。", 70),
  fixed("energy_return_breakpoint_2_increase", "疾风骤雨能量回复第二次增加", "INTEGER", calcPart("leesin_p", "EnergyReturn").mBreakpoints[1].mAdditionalBonusAtThisLevel, "当前13级增加5点。", 80),
  fixed("first_hit_energy_multiplier", "疾风骤雨第一次攻击能量倍率", "INTEGER", scalar("leesin_p", "FirstHitEnergyMult"), "TTFirstHitEnergy以FirstHitEnergyMult修改EnergyReturn，当前倍率2。", 90),
], [
  formula("first_hit_energy_return", "疾风骤雨第一次攻击能量回复", mul(P("energy_return_at_character_level"), P("first_hit_energy_multiplier")), "当前TTFirstHitEnergy=EnergyReturn×FirstHitEnergyMult；第一次和第二次回复分开。", 10),
], [], [
  { item: "攻击、技能触发和第二次攻击时序", reason: "本轮只保存自身数值，不创建攻击事件或内部状态。" },
], [
  { item: "EnergyReturn角色等级实际求值", reason: "保留断点来源和运行输入；未编完整等级曲线。" },
], "疾风骤雨保留能量资源和两次攻击的区分，第一次使用Modified树倍率2，第二次使用角色等级运行值。", { first_hit_energy_return: ["TTFirstHitEnergy", "EnergyReturn"] });

put("leesin_q", [
  skillLevels("q1_base_damage", "天音波首段基础物理伤害", "INTEGER", pick("leesin_q", "Q1BaseDamage", 1, 5), "客户端当前根绑定Q1BaseDamage取技能等级索引1至5为60/90/120/150/180。", 10),
  skillLevels("q2_base_damage", "回音击再施放基础物理伤害", "INTEGER", pick("leesin_q", "Q2BaseDamage", 1, 5), "客户端当前根绑定Q2BaseDamage取技能等级索引1至5为60/90/120/150/180。", 20),
  fixed("q1_bonus_ad_ratio", "天音波额外攻击力比例", "DECIMAL", scalar("leesin_q", "Q1ADRatio"), "InitialDamage的mStat=2、mStatFormula=2，按来源额外攻击力读取。", 30),
  fixed("q2_bonus_ad_ratio", "回音击额外攻击力比例", "DECIMAL", scalar("leesin_q", "Q2ADRatio"), "RecastDamage的mStat=2、mStatFormula=2，按来源额外攻击力读取。", 40),
  fixed("reactivate_window_ms", "天音波再次施放窗口（毫秒）", "INTEGER", ms(scalar("leesin_q", "ReactivateTime")), "当前ReactivateTime=3秒，转换为3000毫秒。", 50),
  fixed("cast_time_ms", "天音波根施法时间（毫秒）", "INTEGER", rootMs("leesin_q"), "只记录根spellCastTime。", 60),
  fixed("empowered_damage_multiplier", "回音击最高伤害倍率", "DECIMAL", multiplierNumber("leesin_q", "EmpoweredDamage"), "当前绑定正文消费EmpoweredDamage最高值；只保留一次完整回音击基础树乘2，不把tooltipOnly树重复作为另一段伤害。", 70),
  skillLevels("energy_cost", "天音波能量消耗", "INTEGER", [50, 50, 50, 50, 50], "当前英雄资源为能量；冻结官方成本等级1至5均为50，本参数不与法力字段混用。", 80),
], [
  formula("initial_physical_damage", "天音波首段单一敌人物理伤害", add(P("q1_base_damage"), mul(P("q1_bonus_ad_ratio"), AD_BONUS())), "当前InitialDamage=Q1BaseDamage+Q1ADRatio×来源额外攻击力。", 10),
  formula("recast_physical_damage", "回音击再施放单一敌人物理伤害基础项", add(P("q2_base_damage"), mul(P("q2_bonus_ad_ratio"), AD_BONUS())), "当前RecastDamage=Q2BaseDamage+Q2ADRatio×来源额外攻击力；目标已损生命的中间曲线没有计算树。", 20),
  formula("empowered_physical_damage", "回音击最高单一敌人物理伤害", mul(P("empowered_damage_multiplier"), add(P("q2_base_damage"), mul(P("q2_bonus_ad_ratio"), AD_BONUS()))), "当前正文消费EmpoweredDamage最高值；按完整RecastDamage树乘2，目标已损生命的中间曲线仍待补。", 30),
], [energyEffect("leesin_q")], [
  { item: "Q2MaxMissingHealthMod", reason: "当前根计算树和正文不消费该DataValue；不得用它补造已损生命曲线。" },
  { item: "EmpoweredDamage的独立重复树", reason: "保留一棵完整回音击最高值公式；不再把tooltipOnly节点另建为第二套重复伤害。" },
  { item: "真实视野、突进几何和SWIFTPLAY", reason: "属于视野/空间或模式分支。" },
], [
  { item: "回音击已损生命中间曲线", reason: "保留RecastDamage基础树与最高展示边界，不猜线性函数。" },
  { item: "首个命中与再次施放事件", reason: "同一技能两段保留，事件和目标资格待接。" },
], "天音波/回音击分列首段、再施放和当前正文消费的最高值树；能量消耗新增为能量而非旧根mana名称。", { initial_physical_damage: ["InitialDamage"], recast_physical_damage: ["RecastDamage"], empowered_physical_damage: ["EmpoweredDamage", "RecastDamage"] });

put("leesin_w", [
  skillLevels("shield_base", "金钟罩基础护盾", "INTEGER", pick("leesin_w", "ShieldValue", 1, 5), "客户端当前根绑定ShieldValue取技能等级索引1至5为60/105/150/195/240，索引0的15为旧占位。", 10),
  fixed("shield_ap_ratio", "金钟罩法术强度比例", "DECIMAL", coefficient("leesin_w", "ShieldAmount", 1), "ShieldAmount第二项无mStat，按同版窄证读取来源总法术强度。", 20),
  fixed("shield_duration_ms", "金钟罩护盾持续（毫秒）", "INTEGER", ms(scalar("leesin_w", "ShieldDuration")), "当前ShieldDuration=2秒，转换为2000毫秒。", 30),
  skillLevels("omnivamp_ratio", "铁布衫全能吸血比例", "DECIMAL", pick("leesin_w", "LifestealAndSpellVamp", 1, 5, value => clean(value / 100)), "当前正文直接接LifestealAndSpellVamp百分号；原始10/14/18/22/26百分数点转为0.10至0.26比例。", 40),
  fixed("omnivamp_duration_ms", "铁布衫全能吸血持续（毫秒）", "INTEGER", ms(scalar("leesin_w", "LifestealAndSpellVampTime")), "当前LifestealAndSpellVampTime=4秒，转换为4000毫秒。", 50),
  fixed("reactivate_window_ms", "金钟罩再次施放窗口（毫秒）", "INTEGER", ms(scalar("leesin_w", "W1ReactivateTime")), "当前W1ReactivateTime=3秒，转换为3000毫秒。", 60),
  skillLevels("energy_cost", "金钟罩能量消耗", "INTEGER", [50, 50, 50, 50, 50], "当前英雄资源为能量；官方成本等级1至5均为50。", 70),
], [
  formula("shield_value", "金钟罩自身护盾值", add(P("shield_base"), mul(P("shield_ap_ratio"), AP())), "当前ShieldAmount=ShieldValue+0.8×来源总法术强度；友军英雄资格与自身目标分支由事件层接线。", 10),
], [
  energyEffect("leesin_w"),
  normalShieldEffect("self_shield", "金钟罩自身普通护盾", { kind: "FORMULA", formulaKey: "shield_value" }, "shield_duration_ms", "当前正文明确友军英雄目标时李青自身获得护盾；只定义自身普通护盾，不替代友军目标分支。", 20),
  attributeEffect("omnivamp", "铁布衫自身全能吸血", { kind: "PARAMETER", parameterKey: "omnivamp_ratio" }, "omnivamp_percent", "omnivamp_duration_ms", "当前正文明确再次施放后自身获得全能吸血；再次施放事件待接。", 30),
], [
  { item: "守卫/友军目标的护盾结果", reason: "第三方目标结果不在本轮自身与单一敌人范围；参数和自身护盾保留。" },
  { item: "W1CooldownRecovered和SWIFTPLAY", reason: "当前正文与计算树未消费或属于模式字段。" },
], [
  { item: "友军英雄资格、再次施放和减速衰减事件", reason: "数值与生命周期保存，触发目标和衰减曲线待接。" },
], "金钟罩的自身护盾与铁布衫全能吸血分别表达，能量消耗使用energy资源键。", { shield_value: ["ShieldAmount"] });

put("leesin_e", [
  skillLevels("slow_percent_points", "摧筋断骨初始减速百分数点", "INTEGER", pick("leesin_e", "SlowAmount", 1, 5), "当前正文直接接SlowAmount百分号；技能等级索引1至5为35/45/55/65/75百分数点。", 10),
  skillLevels("base_magic_damage", "天雷破基础魔法伤害", "INTEGER", pick("leesin_e", "E1Damage", 1, 5), "客户端当前根绑定E1Damage取技能等级索引1至5为35/60/85/110/135。", 20),
  fixed("total_ad_ratio", "天雷破总攻击力比例", "DECIMAL", coefficient("leesin_e", "InitialDamage", 1), "InitialDamage的mStat=2且省略mStatFormula，按同版窄证读取来源总攻击力。", 30),
  fixed("slow_duration_ms", "摧筋断骨减速及显形持续（毫秒）", "INTEGER", ms(scalar("leesin_e", "SlowDuration")), "当前SlowDuration=4秒，转换为4000毫秒；减速衰减曲线未证。", 40),
  fixed("reactivate_window_ms", "天雷破再次施放窗口（毫秒）", "INTEGER", ms(scalar("leesin_e", "ReactivateTime")), "当前ReactivateTime=3秒，转换为3000毫秒。", 50),
  fixed("cast_time_ms", "天雷破根施法时间（毫秒）", "INTEGER", rootMs("leesin_e"), "只记录根spellCastTime。", 60),
  skillLevels("energy_cost", "天雷破能量消耗", "INTEGER", [50, 50, 50, 50, 50], "当前英雄资源为能量；官方成本等级1至5均为50。", 70),
], [
  formula("initial_magic_damage", "天雷破首段单一敌人魔法伤害", add(P("base_magic_damage"), mul(P("total_ad_ratio"), AD_TOTAL())), "当前InitialDamage=E1Damage+0.9×来源总攻击力。", 10),
], [energyEffect("leesin_e")], [
  { item: "减速逐渐恢复的完整曲线", reason: "当前正文只有持续时间和初始减速，没有恢复曲线。" },
  { item: "显形、空间范围与SWIFTPLAY", reason: "视野、空间和模式分支不进入本轮公式。" },
], [
  { item: "首段命中与再次施放时序", reason: "保留两段共用窗口与减速持续，触发事件待接。" },
], "天雷破/摧筋断骨保存首段伤害和再施放减速数值；mStat2省略formula按总攻击力窄口径。", { initial_magic_damage: ["InitialDamage"] });

put("leesin_r", [
  skillLevels("base_damage", "猛龙摆尾基础物理伤害", "INTEGER", pick("leesin_r", "BaseDamage", 1, 3), "客户端当前根绑定BaseDamage取技能等级索引1至3为175/400/625；索引0的-50不是1级值。", 10),
  fixed("bonus_ad_ratio", "猛龙摆尾额外攻击力比例", "DECIMAL", coefficient("leesin_r", "Damage", 1), "Damage的mStat=2、mStatFormula=2，按来源额外攻击力读取。", 20),
  fixed("kick_distance", "猛龙摆尾击退距离", "INTEGER", scalar("leesin_r", "KickDistance"), "当前KickDistance=800；只记录空间参数，不创建击退结果。", 30),
  fixed("cast_time_ms", "猛龙摆尾根施法时间（毫秒）", "INTEGER", rootMs("leesin_r"), "只记录根spellCastTime；施法时间内禁锢为正文附加语义。", 40),
], [
  formula("physical_damage", "猛龙摆尾主目标单一敌人物理伤害", add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前Damage=BaseDamage+2×来源额外攻击力；碰撞目标的额外生命附加是另一目标分支。", 10),
], [], [
  { item: "碰撞到其他英雄的额外伤害公式和初始目标额外生命", reason: "该支路要求另一名敌方英雄及其额外生命，本轮唯一敌方英雄一对一范围不写入参数或公式。" },
  { item: "击退、击飞和施法内禁锢结果", reason: "控制和时序不创建直接结果。" },
], [
  { item: "目标碰撞、额外生命求值和地图边界", reason: "主目标伤害已保留，碰撞事件及额外目标接线待补。" },
], "猛龙摆尾只保留主目标伤害和击退距离；碰撞目标额外生命支路属于多目标范围，本轮排除。", { physical_damage: ["Damage"] });

// 斯卡纳
put("skarner_p", [
  fixed("stacks_to_trigger", "战栗触发层数", "INTEGER", scalar("skarner_p", "StacksToTriggerPassive"), "当前正文明确3层触发。", 10),
  fixed("duration_ms", "战栗持续（毫秒）", "INTEGER", ms(scalar("skarner_p", "Duration")), "当前Duration=4秒，转换为4000毫秒。", 20),
  runtime("percent_health_base_at_character_level", "战栗最大生命伤害角色等级实际基础值", "DECIMAL", "PercentHealthDamage只有角色等级插值5至9；运行层提供当前角色等级实际基础值，不把端点线性展开。", 30),
  fixed("percent_health_level1_value", "战栗最大生命伤害角色等级起点", "INTEGER", calcPart("skarner_p", "PercentHealthDamage").mStartValue, "当前角色等级插值起点5。", 40),
  fixed("percent_health_level_max_value", "战栗最大生命伤害角色等级终点", "INTEGER", calcPart("skarner_p", "PercentHealthDamage").mEndValue, "当前角色等级插值终点9。", 50),
  fixed("percent_health_multiplier", "战栗最大生命伤害显示倍率", "DECIMAL", multiplierNumber("skarner_p", "PercentHealthDamage"), "当前树mMultiplier约0.01且mDisplayAsPercent为真；保留来源倍率，不按显示精度另行舍入。", 60),
], [
  formula("percent_health_damage_ratio", "战栗目标最大生命伤害比例", mul(P("percent_health_multiplier"), P("percent_health_base_at_character_level")), "当前PercentHealthDamage=0.01×角色等级插值基础值，结果按百分数显示；实际目标最大生命和周期事件待接。", 10),
], [], [
  { item: "野怪总伤害上限", reason: "扩展正文只针对野怪，本轮唯一敌方英雄不建立野怪封顶参数。" },
  { item: "TickFrequency与每跳过程", reason: "当前正文未消费TickFrequency，不把0.5秒字段编成周期过程。" },
], [
  { item: "角色等级插值实际值、目标最大生命和满层事件", reason: "保留端点和无默认运行输入，实际层数、目标资格与周期由事件层提供。" },
], "战栗只保存满层比例树的倍率、角色等级端点和运行值；不把显示百分数或TickFrequency误作完整周期。", { percent_health_damage_ratio: ["PercentHealthDamage"] });

put("skarner_q", [
  skillLevels("cooldown_ms", "撼地基础冷却（毫秒）", "INTEGER", rootField("skarner_q", "cooldownTime").slice(1, 6).map(ms), "当前root.cooldownTime按技能等级取索引1至5；mDoesNotConsumeCooldown不覆盖实际基础冷却数据。", 5),
  skillLevels("base_damage", "撼地强化攻击基础物理伤害", "INTEGER", pick("skarner_q", "BaseDamage", 1, 5), "客户端当前根绑定BaseDamage取技能等级索引1至5为10/20/30/40/50。", 10),
  fixed("max_health_ratio", "撼地最后一次攻击目标最大生命伤害比例", "DECIMAL", scalar("skarner_q", "MaxHPPercent"), "正文将MaxHPPercent乘100显示；目标最大生命属性和最后一次攻击事件待接。", 20),
  fixed("slow_duration_ms", "撼地减速持续（毫秒）", "INTEGER", ms(scalar("skarner_q", "SlowDuration")), "当前SlowDuration=1秒，转换为1000毫秒。", 30),
  fixed("slow_ratio", "撼地减速比例", "DECIMAL", scalar("skarner_q", "SlowPercent"), "正文将SlowPercent乘100显示；保存0.4比例。", 40),
  skillLevels("attack_speed_ratio", "撼地强化攻击速度比例", "DECIMAL", pick("skarner_q", "AttackSpeed", 1, 5), "正文将AttackSpeed乘100显示；技能等级索引1至5为0.20至0.40。", 50),
  fixed("empowered_attack_count", "撼地强化攻击次数", "INTEGER", 3, "当前正文明确接下来的3次攻击获得强化；只保存次数，不创建攻击事件。", 60),
  fixed("bonus_health_ratio", "撼地额外生命比例", "DECIMAL", scalar("skarner_q", "BonusHealthRatio"), "AbilityDamage的mStat=12、mStatFormula=2；结合同版窄证映射为来源额外生命，使用SOURCE.hp.BONUS。", 70),
  fixed("bonus_ad_ratio", "撼地额外攻击力比例", "DECIMAL", scalar("skarner_q", "ADRatio"), "AbilityDamage的mStat=2、mStatFormula=2，读取来源额外攻击力。", 80),
  fixed("rock_hold_duration_ms", "撼地巨石持有时间（毫秒）", "INTEGER", ms(scalar("skarner_q", "RockHoldDuration")), "当前RockHoldDuration=5秒，转换为5000毫秒。", 90),
  fixed("cast_time_ms", "撼地根施法时间（毫秒）", "INTEGER", rootMs("skarner_q"), "只记录根spellCastTime。", 100),
], [
  formula("ability_damage", "撼地强化攻击单一敌人物理伤害", add(add(P("base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), mul(P("bonus_health_ratio"), HP_BONUS())), "当前AbilityDamage=BaseDamage+0.9×来源额外攻击力+0.03×来源额外生命；最后一次攻击的最大生命比例另行保存。", 10),
], [manaEffect("skarner_q")], [
  { item: "cooldown_ms误用占位", reason: "本参数由生成器从根cooldownTime按索引1至5直接读取，见脚本后置赋值；不使用伪造DataValues名称。" },
  { item: "野怪封顶和建筑物倍率", reason: "扩展正文专用分支；本轮唯一敌方英雄不建立。" },
  { item: "投掷巨石的其它敌人、命中盒和攻击次数事件", reason: "目标分支和空间时序不并入单一敌人公式。" },
], [
  { item: "最后一次攻击、目标最大生命和三次攻击事件", reason: "参数已保存，事件和目标生命实际输入待接。" },
], "撼地保留下3次强化攻击主树、最后一次目标最大生命比例和减速数据；mStat12按同版窄证映射为来源额外生命，冷却不因根旗标删除。", { ability_damage: ["AbilityDamage"] });

// Skarner Q 冷却来自根数组，不在DataValues中，替换上面有意阻止误取的临时节点。
writes.skarner_q.parameters = writes.skarner_q.parameters.filter(item => item.parameterKey !== "cooldown_ms");
writes.skarner_q.parameters.unshift(skillLevels("cooldown_ms", "撼地基础冷却（毫秒）", "INTEGER", rootField("skarner_q", "cooldownTime").slice(1, 6).map(ms), "当前root.cooldownTime按技能等级取索引1至5；mDoesNotConsumeCooldown不覆盖实际基础冷却数据。", 5));

put("skarner_w", [
  skillLevels("base_damage", "震地壁垒基础魔法伤害", "INTEGER", pick("skarner_w", "BaseDamage", 1, 5), "客户端当前根绑定BaseDamage取技能等级索引1至5为50/70/90/110/130。", 10),
  fixed("damage_ap_ratio", "震地壁垒法术强度比例", "DECIMAL", scalar("skarner_w", "DamageAPRatio"), "Damage的StatByNamedDataValue使用DamageAPRatio，按同版窄证读取来源总法术强度。", 20),
  fixed("shield_stat12_ratio", "震地壁垒自身护盾生命总值比例", "DECIMAL", scalar("skarner_w", "InitialShieldRatio"), "InitialShield使用mStat=12；结合同版窄证映射为来源生命总值，使用SOURCE.hp.TOTAL。", 30),
  fixed("shield_duration_ms", "震地壁垒护盾持续（毫秒）", "INTEGER", ms(scalar("skarner_w", "ShieldDuration")), "当前ShieldDuration=2.5秒，转换为2500毫秒。", 40),
  fixed("slow_ratio", "震地壁垒减速比例", "DECIMAL", Math.abs(scalar("skarner_w", "SlowEffect")), "正文使用SlowEffect*-100显示正减速；保存0.20比例并记录来源为-0.20。", 50),
  fixed("slow_duration_ms", "震地壁垒减速持续（毫秒）", "INTEGER", ms(scalar("skarner_w", "SlowDuration")), "当前SlowDuration=1秒，转换为1000毫秒。", 60),
  fixed("cast_time_ms", "震地壁垒根施法时间（毫秒）", "INTEGER", rootMs("skarner_w"), "只记录根spellCastTime。", 70),
], [
  formula("magic_damage", "震地壁垒附近单一敌人魔法伤害", add(P("base_damage"), mul(P("damage_ap_ratio"), AP())), "当前Damage=BaseDamage+0.8×来源总法术强度。", 10),
  formula("shield_value", "震地壁垒自身护盾值", mul(P("shield_stat12_ratio"), HP_TOTAL()), "当前InitialShield=0.08×来源生命总值；mStat12映射依据同版窄证。", 20),
], [
  manaEffect("skarner_w"),
  normalShieldEffect("self_shield", "震地壁垒自身普通护盾", { kind: "FORMULA", formulaKey: "shield_value" }, "shield_duration_ms", "当前正文明确自身获得护盾；地震伤害和减速是另一组数值。", 20),
], [
  { item: "附近额外敌人逐个命中", reason: "本轮只表达单一敌人伤害公式，不创建范围结果。" },
  { item: "Tick/命中盒时序", reason: "当前数据字段未构成当前正文消费的周期过程。" },
], [
  { item: "护盾、地震、减速的触发时序", reason: "数值与生命周期已保存，具体事件待接。" },
], "震地壁垒分离自身护盾、附近伤害和减速，护盾使用来源生命总值映射。", { magic_damage: ["Damage"], shield_value: ["InitialShield"] });

put("skarner_e", [
  fixed("charge_duration_ms", "以绪塔尔冲击冲锋持续（毫秒）", "INTEGER", ms(scalar("skarner_e", "ChargeDuration")), "当前ChargeDuration=2.75秒，转换为2750毫秒。", 10),
  fixed("initial_speed", "以绪塔尔冲锋初速度", "INTEGER", scalar("skarner_e", "InitialSpeed"), "当前冲锋空间参数。", 20),
  fixed("acceleration", "以绪塔尔冲锋加速度", "INTEGER", scalar("skarner_e", "Acceleration"), "当前冲锋空间参数。", 30),
  fixed("maximum_speed", "以绪塔尔冲锋最大速度", "INTEGER", scalar("skarner_e", "MaximumSpeed"), "当前冲锋空间参数。", 40),
  fixed("stun_duration_ms", "以绪塔尔冲击晕眩持续（毫秒）", "INTEGER", ms(scalar("skarner_e", "StunDuration")), "当前正文明确撞墙晕眩1.1秒，转换为1100毫秒。", 50),
  skillLevels("pin_base_damage", "以绪塔尔冲击撞墙基础物理伤害", "INTEGER", pick("skarner_e", "PinBaseDamage", 1, 5), "客户端当前根绑定PinBaseDamage取技能等级索引1至5为30/60/90/120/150。", 60),
  fixed("bonus_ad_ratio", "以绪塔尔冲击撞墙额外攻击力比例", "DECIMAL", scalar("skarner_e", "ADRatio"), "PinDamage的mStat=2、mStatFormula=2，按来源额外攻击力读取。", 70),
  fixed("pin_stat12_ratio", "以绪塔尔冲击撞墙生命总值比例", "DECIMAL", scalar("skarner_e", "PinDamageRatio"), "PinDamage的mStat=12；结合同版窄证映射为来源生命总值，使用SOURCE.hp.TOTAL。", 80),
  fixed("refund_percent", "以绪塔尔冲击撞墙后冷却保留比例", "DECIMAL", scalar("skarner_e", "RefundPercent"), "当前正文写冷却时间降至65%，保存0.65保留比例，不写成返还65%。", 90),
], [
  formula("pin_physical_damage", "以绪塔尔冲击撞墙单一敌人物理伤害", add(add(P("pin_base_damage"), mul(P("bonus_ad_ratio"), AD_BONUS())), mul(P("pin_stat12_ratio"), HP_TOTAL())), "当前PinDamage=PinBaseDamage+1.2×来源额外攻击力+0.06×来源生命总值；只在拖拽后撞墙事件中成立。", 10),
], [manaEffect("skarner_e")], [
  { item: "碰撞过程命中盒、预警和MinimumQRenew", reason: "属于空间与表现/内部字段，不建立伤害或周期公式。" },
  { item: "大型野怪目标分支", reason: "本轮唯一敌方英雄范围不创建兵野专用资格或结果。" },
], [
  { item: "冲锋、拖拽、撞墙和冷却降至事件", reason: "保留对应数值，事件时序和目标资格待接。" },
], "以绪塔尔冲击把冲锋空间参数、撞墙伤害、晕眩与冷却保留比例分开；mStat12按同版窄证映射为来源生命总值，不将冲锋途中当作伤害。", { pin_physical_damage: ["PinDamage"] });

put("skarner_r", [
  skillLevels("base_damage", "毒刺贯体基础魔法伤害", "INTEGER", pick("skarner_r", "BaseDamage", 1, 3), "客户端当前根绑定BaseDamage取技能等级索引1至3为150/250/350。", 10),
  fixed("ap_ratio", "毒刺贯体法术强度比例", "DECIMAL", coefficient("skarner_r", "Damage", 1), "Damage第二项无mStat，按同版窄证读取来源总法术强度。", 20),
  fixed("suppression_duration_ms", "毒刺贯体压制持续（毫秒）", "INTEGER", ms(scalar("skarner_r", "Duration")), "当前Duration=1.5秒，转换为1500毫秒。", 30),
  fixed("self_move_speed_ratio", "毒刺贯体命中英雄自身移动速度比例", "DECIMAL", scalar("skarner_r", "SpeedBoostAmount"), "正文将SpeedBoostAmount乘100显示；保存0.4比例。", 40),
  fixed("self_move_speed_duration_ms", "毒刺贯体自身移动速度持续（毫秒）", "INTEGER", ms(scalar("skarner_r", "SpeedBoostDuration")), "当前SpeedBoostDuration=1.5秒，转换为1500毫秒。", 50),
  fixed("cast_time_ms", "毒刺贯体根施法时间（毫秒）", "INTEGER", rootMs("skarner_r"), "只记录根spellCastTime。", 60),
], [
  formula("magic_damage", "毒刺贯体单一敌方英雄魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), AP())), "当前Damage=BaseDamage+1×来源总法术强度；最多三个英雄的额外目标由事件层分开。", 10),
], [
  manaEffect("skarner_r"),
  attributeEffect("self_move_speed", "毒刺贯体命中英雄自身移动速度", { kind: "PARAMETER", parameterKey: "self_move_speed_ratio" }, "move_speed_percent", "self_move_speed_duration_ms", "当前正文明确至少命中一个英雄后自身获得移动速度；命中事件待接。", 20),
], [
  { item: "第二、第三敌方英雄命中", reason: "本轮一对一只保留单一敌方英雄主伤害，不建立多目标结果。" },
  { item: "拖行、命中盒和撼地/擎天切换事件", reason: "属于控制/空间/跨技能时序。" },
], [
  { item: "至少命中一个英雄的自身加速触发", reason: "自身属性效果已保存，触发条件待接。" },
], "毒刺贯体保留单一敌方英雄伤害和命中后的自身移速，额外敌人分支不并入。", { magic_damage: ["Damage"] });

// 凯尔
put("kayle_p", [
  fixed("level_for_rank_0", "登神长阶狂热等级门槛", "INTEGER", scalar("kayle_p", "LevelForPassiveRank0"), "当前角色等级门槛1；等级变化不替换整套技能。", 10),
  fixed("level_for_rank_1", "登神长阶升腾等级门槛", "INTEGER", scalar("kayle_p", "LevelForPassiveRank1"), "当前角色等级门槛6。", 20),
  fixed("level_for_rank_2", "登神长阶炽诚等级门槛", "INTEGER", scalar("kayle_p", "LevelForPassiveRank2"), "当前角色等级门槛11。", 30),
  fixed("level_for_rank_3", "登神长阶超然等级门槛", "INTEGER", scalar("kayle_p", "LevelForPassiveRank3"), "当前角色等级门槛16。", 40),
  fixed("upgraded_attack_range", "登神长阶升腾攻击距离", "INTEGER", scalar("kayle_p", "UpgradedAttackRange"), "当前6级攻击距离525。", 50),
  fixed("final_attack_range", "登神长阶超然攻击距离", "INTEGER", scalar("kayle_p", "FinalAttackRange"), "当前16级攻击距离625。", 60),
  fixed("self_move_speed_ratio", "登神长阶满层自身移动速度比例", "DECIMAL", scalar("kayle_p", "MSTowardsEnemy"), "正文将MSTowardsEnemy乘100显示；当前值0.1，触发条件由层数/角色等级事件提供。", 70),
  fixed("self_move_speed_radius", "登神长阶自身移动速度作用半径", "INTEGER", scalar("kayle_p", "MSTowardsEnemyRadius"), "当前作用半径2000；只作来源数值。", 80),
  fixed("max_stack_count", "登神长阶攻击层数上限", "INTEGER", scalar("kayle_p", "EnrageMaxStacks"), "当前正文明确最大5层。", 90),
  fixed("stack_duration_ms", "登神长阶攻击层数持续（毫秒）", "INTEGER", ms(scalar("kayle_p", "EnrageDuration")), "当前EnrageDuration=5秒，转换为5000毫秒。", 100),
  fixed("attack_speed_per_stack_percent_points", "登神长阶每层攻击速度百分数点", "INTEGER", scalar("kayle_p", "EnrageASPerStack"), "当前正文直接接EnrageTotalASPerStack百分号，计算树直接引用EnrageASPerStack。", 110),
  runtime("passive_wave_base_at_character_level", "登神长阶焰浪角色等级实际基础值", "DECIMAL", "PassiveWaveDamage的1级起点20与12级起每级增加3属于角色等级断点；运行层提供当前角色等级实际基础值，不展开1至18固定曲线。", 120),
  fixed("passive_wave_level1_value", "登神长阶焰浪角色等级起点", "INTEGER", calcPart("kayle_p", "PassiveWaveDamage").mLevel1Value, "当前焰浪角色等级起点20。", 130),
  fixed("passive_wave_breakpoint_level", "登神长阶焰浪增加断点等级", "INTEGER", calcPart("kayle_p", "PassiveWaveDamage").mBreakpoints[0].mLevel, "当前12级起进入增加。", 140),
  fixed("passive_wave_breakpoint_increment", "登神长阶焰浪每级增加", "INTEGER", calcPart("kayle_p", "PassiveWaveDamage").mBreakpoints[0].mBonusPerLevelAtAndAfter, "当前12级起每级增加3。", 150),
  fixed("passive_wave_ap_ratio", "登神长阶焰浪法术强度比例", "DECIMAL", scalar("kayle_p", "PassiveWaveAPRatio"), "当前PassiveWaveDamage第二项无mStat，按同版窄证读取来源总法术强度。", 160),
  fixed("passive_wave_bonus_ad_ratio", "登神长阶焰浪额外攻击力比例", "DECIMAL", scalar("kayle_p", "PassiveWaveBonusADRatio"), "当前第三项mStat=2、mStatFormula=2，读取来源额外攻击力。", 170),
], [
  formula("passive_wave_magic_damage", "登神长阶焰浪单一敌人魔法伤害", add(add(P("passive_wave_base_at_character_level"), mul(P("passive_wave_ap_ratio"), AP())), mul(P("passive_wave_bonus_ad_ratio"), AD_BONUS())), "当前PassiveWaveDamage=角色等级焰浪基础值+0.25×来源总法术强度+0.1×来源额外攻击力；保持角色等级断点输入。", 10),
], [
  attributeEffect("self_move_speed", "登神长阶满层自身移动速度", { kind: "PARAMETER", parameterKey: "self_move_speed_ratio" }, "move_speed_percent", null, "当前正文明确满层昂扬时自身获得移动速度；层数和角色等级触发待接。", 20, persistentLifecycle()),
], [
  { item: "焰浪暴击与法术特效", reason: "扩展正文只说明效能，不创建暴击或攻击事件。" },
  { item: "等级替换整套技能", reason: "等级是同一技能的进阶门槛，不能拆成多个技能。" },
], [
  { item: "层数累积、11级焰浪资格和16级永久昂扬", reason: "保留门槛、层数和数值；触发时序待接。" },
], "登神长阶把角色等级门槛、层数自身属性和焰浪计算树放在同一技能；不把角色等级进阶当作技能替换。", { passive_wave_magic_damage: ["PassiveWaveDamage"] });

put("kayle_q", [
  skillLevels("base_damage", "耀焰冲击基础魔法伤害", "INTEGER", pick("kayle_q", "Damage", 1, 5), "客户端当前根绑定Damage取技能等级索引1至5为60/90/120/150/180。", 10),
  fixed("ap_ratio", "耀焰冲击法术强度比例", "DECIMAL", coefficient("kayle_q", "TotalDamage", 1), "TotalDamage的第二项无mStat，按同版窄证读取来源总法术强度。", 20),
  fixed("bonus_ad_ratio", "耀焰冲击额外攻击力比例", "DECIMAL", coefficient("kayle_q", "TotalDamage", 2), "TotalDamage的第三项mStat=2、mStatFormula=2，读取来源额外攻击力。", 30),
  skillLevels("slow_percent_points", "耀焰冲击减速百分数点", "INTEGER", pick("kayle_q", "SlowPercent", 1, 5), "当前正文直接接SlowPercent百分号；技能等级索引1至5为25/30/35/40/45。", 40),
  fixed("slow_duration_ms", "耀焰冲击减速持续（毫秒）", "INTEGER", ms(scalar("kayle_q", "SlowDuration")), "当前SlowDuration=2秒，转换为2000毫秒。", 50),
  fixed("shred_percent_points", "耀焰冲击护甲魔抗削减百分数点", "INTEGER", scalar("kayle_q", "ShredPercent"), "当前正文直接接ShredPercent百分号，保存15百分数点。", 60),
  fixed("shred_duration_ms", "耀焰冲击削减持续（毫秒）", "INTEGER", ms(scalar("kayle_q", "ShredDuration")), "当前ShredDuration=4秒，转换为4000毫秒。", 70),
], [
  formula("magic_damage", "耀焰冲击单一敌人魔法伤害", add(add(P("base_damage"), mul(P("ap_ratio"), AP())), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前TotalDamage=Damage+0.5×来源总法术强度+0.6×来源额外攻击力。", 10),
], [manaEffect("kayle_q")], [
  { item: "Explosion几何和未消费退还比例", reason: "当前正文未提供独立爆炸伤害树；ManaRefundPercent不在当前正文消费。" },
  { item: "尾部冷却占位7和mDoesNotConsume标志", reason: "冷却/法力已由公共参数保护，不能据标志删改。" },
], [
  { item: "减速、削减和穿透多个敌人的事件", reason: "数值保留，控制目标和后方敌人事件待接。" },
  { item: "CastDelay前摇", reason: "DataValues.CastDelay为0.25秒但根spellCastTime为0，二者冲突；暂不把其写成已证施法时长。" },
], "耀焰冲击保留实际伤害树与控制/削减数值；CastDelay与根spellCastTime冲突，时序留待接，属性选择器按2/2额外攻击力窄口径。", { magic_damage: ["TotalDamage"] });

put("kayle_w", [
  skillLevels("base_heal", "星界恩典基础治疗", "INTEGER", pick("kayle_w", "Heal", 1, 5), "客户端当前根绑定Heal取技能等级索引1至5为55/80/105/130/155。", 10),
  fixed("heal_ap_ratio", "星界恩典法术强度治疗比例", "DECIMAL", coefficient("kayle_w", "TotalHeal", 1), "TotalHeal第二项无mStat，按同版窄证读取来源总法术强度。", 20),
  skillLevels("haste_ratio", "星界恩典移动速度比例", "DECIMAL", pick("kayle_w", "Haste", 1, 5), "当前正文直接接TotalHaste，计算树标记mDisplayAsPercent；保存技能等级1至5的0.24至0.40。", 30),
  fixed("haste_ap_ratio", "星界恩典法术强度移动速度比例", "DECIMAL", coefficient("kayle_w", "TotalHaste", 1), "TotalHaste第二项为0.0008×来源总法术强度，结果按百分比显示。", 40),
  fixed("haste_duration_ms", "星界恩典移动速度持续（毫秒）", "INTEGER", ms(scalar("kayle_w", "HasteDuration")), "当前HasteDuration=2秒，转换为2000毫秒。", 50),
], [
  formula("heal_value", "星界恩典单次基础治疗值", add(P("base_heal"), mul(P("heal_ap_ratio"), AP())), "当前TotalHeal=Heal+0.25×来源总法术强度；自身和一名友军资格分开。", 10),
  formula("haste_ratio", "星界恩典自身与友军移动速度比例", add(P("haste_ratio"), mul(P("haste_ap_ratio"), AP())), "当前TotalHaste=Haste+0.0008×来源总法术强度，并按百分比显示。", 20),
], [manaEffect("kayle_w")], [
  { item: "目标友军治疗结果", reason: "直接治疗结果不在本轮创建；数值公式保留供后续自身/友军目标接线。" },
  { item: "mDoesNotConsumeMana/mDoesNotConsumeCooldown标志", reason: "与根数组及公共参数并存，不能据标志删改基础消耗和冷却。" },
], [
  { item: "无目标施放选最近伤势友军", reason: "当前正文明确目标选择规则，数值不代表任意目标或自施放资格。" },
], "星界恩典分列治疗和移动速度树，保留自身与一名友军的范围语义，不生成直接治疗结果。", { heal_value: ["TotalHeal"], haste_ratio: ["TotalHaste"] });

put("kayle_e", [
  skillLevels("passive_base_damage", "星火符刃被动基础魔法伤害", "INTEGER", pick("kayle_e", "PassiveDamage", 1, 5), "客户端当前根绑定PassiveDamage取技能等级索引1至5为15/20/25/30/35；索引0重复15不作为起点证据。", 10),
  skillLevels("active_execute_percent_points", "星火符刃主动已损生命百分数点", "DECIMAL", pick("kayle_e", "ActiveExecutePercent", 1, 5), "当前ActiveTotalExecuteDamage树使用百分数点数组，取技能等级索引1至5为8/8.5/9/9.5/10。", 20),
  fixed("passive_ap_ratio", "星火符刃被动法术强度比例", "DECIMAL", scalar("kayle_e", "PassiveAPRatio"), "EPassiveTotalDamage第二项无mStat，按同版窄证读取来源总法术强度。", 30),
  fixed("passive_bonus_ad_ratio", "星火符刃被动额外攻击力比例", "DECIMAL", scalar("kayle_e", "PassiveBonusADRatio"), "EPassiveTotalDamage第三项mStat=2、mStatFormula=2，读取来源额外攻击力。", 40),
  fixed("active_execute_ap_ratio", "星火符刃主动已损生命法术强度比例", "DECIMAL", coefficient("kayle_e", "ActiveTotalExecuteDamage", 1), "主动树第二项为0.015×来源总法术强度，外层mMultiplier约0.01且按百分数显示。", 50),
  fixed("active_execute_multiplier", "星火符刃主动已损生命倍率", "DECIMAL", multiplierNumber("kayle_e", "ActiveTotalExecuteDamage"), "保留当前树外层0.01倍率；不把它与百分数显示重复换算。", 60),
  fixed("buff_duration_ms", "星火符刃主动强化持续（毫秒）", "INTEGER", ms(scalar("kayle_e", "BuffDuration")), "当前来源BuffDuration=5秒；只记录来源时长，不替代下一次攻击事件。", 70),
], [
  formula("passive_magic_damage", "星火符刃被动单一目标额外魔法伤害", add(add(P("passive_base_damage"), mul(P("passive_ap_ratio"), AP())), mul(P("passive_bonus_ad_ratio"), AD_BONUS())), "当前EPassiveTotalDamage=PassiveDamage+0.2×来源总法术强度+0.1×来源额外攻击力。", 10),
  formula("active_execute_ratio", "星火符刃主动已损生命伤害比例", mul(P("active_execute_multiplier"), add(P("active_execute_percent_points"), mul(P("active_execute_ap_ratio"), AP()))), "当前ActiveTotalExecuteDamage=0.01×(ActiveExecutePercent+0.015×来源总法术强度)，结果按百分数显示；目标已损生命由运行层提供。", 20),
], [], [
  { item: "野怪额外伤害上限", reason: "仅扩展正文兵野专用分支。" },
  { item: "爆炸直接伤害、爆炸半径和攻击特效事件", reason: "爆炸影响周围额外敌人，超出本轮唯一敌人范围；当前没有独立爆炸伤害树，不创建伤害结果或伪造公式。" },
  { item: "无关匿名计算树", reason: "未被当前正文消费，不作参数/公式引用。" },
], [
  { item: "主动下一次攻击、已损生命输入和11级爆炸资格", reason: "保留两棵数值树、半径与等级门槛依赖；触发和目标生命待接。" },
], "星火符刃分开保存被动额外伤害与主动已损生命比例；主动树保留0.01外层倍率，爆炸只保留来源半径。", { passive_magic_damage: ["EPassiveTotalDamage"], active_execute_ratio: ["ActiveTotalExecuteDamage"] });

put("kayle_r", [
  skillLevels("base_damage", "圣裁之刻基础魔法伤害", "INTEGER", pick("kayle_r", "Damage", 1, 3), "客户端当前根绑定Damage取技能等级索引1至3为200/300/400。", 10),
  fixed("ap_ratio", "圣裁之刻法术强度比例", "DECIMAL", coefficient("kayle_r", "TotalDamage", 1), "TotalDamage第二项无mStat，按同版窄证读取来源总法术强度。", 20),
  fixed("bonus_ad_ratio", "圣裁之刻额外攻击力比例", "DECIMAL", coefficient("kayle_r", "TotalDamage", 2), "TotalDamage第三项mStat=2、mStatFormula=2，读取来源额外攻击力。", 30),
  fixed("invulnerability_duration_ms", "圣裁之刻友方英雄无敌持续（毫秒）", "INTEGER", ms(scalar("kayle_r", "InvulnDuration")), "当前InvulnDuration=2.5秒，转换为2500毫秒。友方英雄资格不由范围推断。", 40),
  skillLevels("aoe_radius", "圣裁之刻范围半径", "INTEGER", pick("kayle_r", "AoERadius", 1, 3), "当前正文消费AoERadius，技能等级索引1至3为675/675/775。", 50),
  skillLevels("mana_cost", "圣裁之刻法力消耗", "INTEGER", [100, 50, 0], "当前官方基础消耗按技能等级索引1至3为100/50/0；根mana数组尾部占位不覆盖该值。", 60),
], [
  formula("magic_damage", "圣裁之刻范围内单一敌人魔法伤害", add(add(P("base_damage"), mul(P("ap_ratio"), AP())), mul(P("bonus_ad_ratio"), AD_BONUS())), "当前TotalDamage=Damage+0.7×来源总法术强度+1×来源额外攻击力；友方无敌与敌方伤害分开。", 10),
], [
  manaEffect("kayle_r"),
], [
  { item: "友方英雄无敌结果", reason: "本轮不创建直接无敌/控制结果，只保存明确持续与目标资格说明。" },
  { item: "附近多个敌人的范围事件", reason: "仅保留单一敌人伤害公式，多个目标由事件层分别结算。" },
  { item: "冷却尾部和mDoesNotConsume标志", reason: "冷却/法力不从非等级占位推断，公共冷却保护与新法力参数分开。" },
], [
  { item: "一名友方英雄选中施放资格", reason: "当前文本明确友方英雄，但mRequiredUnitTags没有可用枚举；不假定自身或任意友方。" },
], "圣裁之刻把敌方伤害与友方英雄无敌持续分开，保留范围等级值但不把范围误作施放资格。", { magic_damage: ["TotalDamage"] });

// 仅在上方定义中没有公共参数时新增法力/能量参数；公共参数本身全部复用，不生成覆盖请求。
for (const skillKey of order) {
  const summary = sourceSummary(skillKey);
  assert(summary && summary.bindingAvailable === true, "技能来源摘要不可用", skillKey);
  assert(writes[skillKey], "技能写入定义缺失", skillKey);
  for (const body of writes[skillKey].parameters) {
    assert(body.valueMode !== "RUNTIME_INPUT" || (body.fixedValue === null && body.levelValues === null), "运行输入不得带默认值", { skillKey, body });
    if (body.valueMode === "SKILL_LEVEL") assert(body.levelValues && Object.keys(body.levelValues).length === summary.officialMaxRank, "技能等级参数数量不符", { skillKey, parameterKey: body.parameterKey, maxLevel: summary.officialMaxRank, levelValues: body.levelValues });
  }
}

// 斯卡纳Q的冷却取根字段，确保没有任何“伪DataValues”残留。
const skarnerQCooldown = rootField("skarner_q", "cooldownTime").slice(1, 6).map(ms);
const skarnerQCooldownParam = writes.skarner_q.parameters.find(item => item.parameterKey === "cooldown_ms");
assert(JSON.stringify(Object.values(skarnerQCooldownParam.levelValues).map(Number)) === JSON.stringify(skarnerQCooldown), "斯卡纳Q冷却索引错误", { actual: skarnerQCooldownParam.levelValues, expected: skarnerQCooldown });

const sourceFor = skillKey => {
  const { hero, skill, raw } = bound(skillKey);
  const summary = sourceSummary(skillKey);
  const officialFile = path.join(inputDir, "参考资料/官方英文", `${hero.id}.json`);
  const official = readJson(officialFile).data?.[hero.id];
  const officialValue = slotOf(skillKey) === "P" ? official?.passive : official?.spells?.[{ Q: 0, W: 1, E: 2, R: 3 }[slotOf(skillKey)]];
  const field = name => raw[name] === undefined ? null : raw[name];
  return {
    hero: hero.id,
    heroName: hero.name,
    heroKey: hero.key,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath || hero.source.rootPath,
    spellPath: skill.binding,
    bindingAvailable: true,
    clientFile: `参考资料/客户端原文/${hero.id}.json.gz`,
    clientSha256: hero.source.client.sha256,
    clientCompressedSha256: hero.source.client.compressedSha256,
    clientBuild: hero.source.client.contentVersion || inputVersion.clientVersion,
    officialZhFile: `参考资料/官方中文/${hero.id}.json`,
    officialZhSha256: sha256File(path.join(inputDir, "参考资料/官方中文", `${hero.id}.json`)),
    officialEnFile: `参考资料/官方英文/${hero.id}.json`,
    officialEnSha256: sha256File(officialFile),
    currentBoundText: skill.currentTexts,
    raw: {
      dataValues: Object.fromEntries((raw.DataValues || []).map(item => [item.name, item.values ? item.values.slice() : null])),
      calculations: clone(raw.mSpellCalculations || {}),
      mEffectAmount: clone(raw.mEffectAmount || null),
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
    officialEvidence: {
      path: `data.${hero.id}.${slotOf(skillKey) === "P" ? "passive" : `spells[${{ Q: 0, W: 1, E: 2, R: 3 }[slotOf(skillKey)]}]`}`,
      name: officialValue?.name || null,
      description: officialValue?.description || null,
      tooltip: officialValue?.tooltip || null,
    },
    currentTextPath: `输入包/来源绑定与当前文本.json -> ${hero.id}/${slotOf(skillKey)}/currentTexts`,
    officialMaxRank: summary.officialMaxRank,
  };
};

const walkFiles = (dir, output = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(file, output);
    else output.push(file);
  }
  return output;
};
const sourceManifest = walkFiles(inputDir).sort().map(file => {
  const relative = path.relative(inputDir, file).replaceAll(path.sep, "/");
  return { path: relative, sha256: sha256File(file), byteSize: fs.statSync(file).size };
});
const declared = new Map((inputVersion.sourceFiles || []).map(item => [item.path, item]));
const inputIntegrity = sourceManifest.map(item => ({
  ...item,
  declaredSha256: declared.get(item.path)?.sha256 ?? null,
  declaredByteSize: declared.get(item.path)?.byteSize ?? null,
  declaredMatch: declared.has(item.path) ? declared.get(item.path).sha256 === item.sha256 && declared.get(item.path).byteSize === item.byteSize : null,
}));
assert(inputIntegrity.every(item => item.declaredMatch !== false), "输入来源字节已漂移", inputIntegrity.filter(item => item.declaredMatch === false));

const snapshotByRoute = new Map((snapshot.requests || []).map(request => [request.route, request]));
const attributes = snapshotByRoute.get("/attributes")?.data?.items || [];
const attributeKeys = new Set(attributes.filter(item => item.status === "ENABLED").map(item => item.attributeKey));
for (const key of ["ability_power", "attack_damage", "bonus_attack_speed_percent", "move_speed_percent", "omnivamp_percent", "mana", "energy", "hp"]) assert(attributeKeys.has(key), "保护快照缺少属性键", key);
const modifiers = snapshotByRoute.get("/modifier-zones")?.data?.items || [];
assert(modifiers.some(item => item.status === "ENABLED" && item.modifierZoneKey === "attribute_flat_add"), "保护快照缺少属性修正区域");

const protectedCurrentCompositionLists = Object.fromEntries(order.map(skillKey => [skillKey, snapshot.summary?.[skillKey]?.components || null]));
const protectedObjects = {
  subjects: order.map(skillKey => ({ skillKey, subject: snapshot.summary?.[skillKey]?.subject || null, source: "输入包/参考资料/当前20槽保护快照.json" })),
  currentCompositionLists: protectedCurrentCompositionLists,
  reusedPublicParameters: reuse,
  protectedReferenceRequests: snapshot.requests || [],
  protectedReferenceRoutes: [...new Set((snapshot.requests || []).map(request => request.route))],
  protectedReferenceCounts: {
    GETs: snapshot.GETs,
    subjects: 20,
    currentCompositionSkillSlots: 20,
    currentCompositionLists: 120,
    reusedPublicParameters: reuse.length,
    images: 20,
    characters: 4,
    characterSkillRelations: 4,
    dictionaries: 4,
  },
  scope: "保护20个既有技能主体、六类组成、25项公共参数、四个角色、角色关系、代表图和四类字典；本批不更新既有对象。",
  snapshotFile: "输入包/参考资料/当前20槽保护快照.json",
  snapshotSha256: sha256File(snapshotPath),
};

const sourceReview = {
  conclusionFile: ".agents/artifacts/hero38-cursor-review-run-20260910/review.md",
  conclusionSha256: sha256File(reviewPath),
  auditFile: ".agents/artifacts/hero38-cursor-review-run-20260910/主负责人执行审计.json",
  auditSha256: sha256File(reviewAuditPath),
  inputManifestFile: ".agents/artifacts/hero38-cursor-review-20260910/输入冻结散列.json",
  inputManifestSha256: sha256File(reviewManifestPath),
  verdict: reviewAudit.verdict,
  runId: reviewAudit.runId,
  requestId: reviewAudit.requestId,
  events: reviewAudit.eventCount,
  uniqueTools: reviewAudit.uniqueTools,
  apiWrites: reviewAudit.apiWrites,
  gitDelta: reviewAudit.gitDelta,
};

const skills = {};
for (const skillKey of order) {
  const { hero } = bound(skillKey);
  const summary = sourceSummary(skillKey);
  skills[skillKey] = {
    skillKey,
    name: `${hero.name}·${summary.name}`,
    maxLevel: summary.officialMaxRank,
    source: sourceFor(skillKey),
    write: writes[skillKey],
    protectedExisting: { subject: true, compositionLists: true, representativeImage: true },
    excluded: excluded[skillKey],
    pending: pending[skillKey],
    proofs: [
      { type: "root-bound-source", path: `输入包/来源绑定与当前文本.json -> ${hero.id}/${slotOf(skillKey)}` },
      { type: "fixed-source-version", client: "16.17", official: "16.17.1", build: "16.17.8104348+branch.releases-16-17.content.release" },
      { type: "cursor-source-review", runId: reviewAudit.runId, verdict: "READY" },
    ],
    proofNote: "",
  };
}

// 不依赖尚未声明的notes对象，使用稳定的来源说明字段覆盖证明文本。
for (const skillKey of order) skills[skillKey].proofNote = `${skills[skillKey].name}沿当前根绑定正文和计算树保存确定数值；未知属性、曲线、目标资格与事件时序保持待接。`;

const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const routeByKind = { parameters: "parameters", formulas: "formulas", effects: "effects", processes: "processes", internalStates: "internal-states", triggerRules: "trigger-rules" };
const keyByKind = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" };
const allWrites = order.flatMap(skillKey => kinds.flatMap(kind => (writes[skillKey].write?.[kind] || writes[skillKey][kind] || []).map(body => ({ skillKey, kind, body }))));
const requestCounts = Object.fromEntries(kinds.map(kind => [kind, allWrites.filter(item => item.kind === kind).length]));
const requestCount = allWrites.length;
const reusedPublicParameters = reuse.map(item => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false }));
const requests = allWrites.map((item, index) => {
  const key = keyByKind[item.kind];
  const stableKey = item.body[key] || item.body.effectKey || item.body.processKey || item.body.stateKey || item.body.ruleKey;
  return {
    sequence: index + 1,
    method: "POST",
    route: `/skills/${item.skillKey}/${routeByKind[item.kind]}`,
    detailRoute: `/skills/${item.skillKey}/${routeByKind[item.kind]}/${stableKey}`,
    skillKey: item.skillKey,
    kind: item.kind,
    stableKey,
    status: "仅意图，未调用",
    body: item.body,
  };
});
assert(requestCount === allWrites.length && requests.every(request => request.stableKey), "请求意图不完整");

const sourceFiles = Object.fromEntries(sourceManifest.map(item => [item.path, { sha256: item.sha256, byteSize: item.byteSize }]));
const counts = {
  newParameters: requestCounts.parameters,
  newFormulas: requestCounts.formulas,
  newEffects: requestCounts.effects,
  newProcesses: requestCounts.processes,
  newInternalStates: requestCounts.internalStates,
  newTriggerRules: requestCounts.triggerRules,
  newTotal: requestCount,
  reusedPublicParameters: reuse.length,
  plannedTotalIncludingReused: requestCount + reuse.length,
  protectedCurrentCompositionLists: 120,
};
const sourceVersion = { clientVersion: "16.17", officialVersion: "16.17.1", build: "16.17.8104348+branch.releases-16-17.content.release" };
const sourceNotes = {
  arrayIndex: "客户端DataValues按实际绑定的技能等级索引1至maxLevel；root cooldownTime按索引1至技能等级，resource cost按官方等级数组/输入版本核对；不使用索引0旧占位或尾部占位。",
  selector: "mStat=2且mStatFormula=2按同版窄证读取来源额外攻击力；mStat=2省略formula的李青E按总攻击力；省略选择器的节点按同版窄证读取法强；J4W/斯卡纳W/E的mStat12按同版窄证映射SOURCE.hp.TOTAL，斯卡纳Q的mStat12并映射SOURCE.hp.BONUS。",
  characterBreakpoints: "J4P冷却断点可由6秒起点及6/11/16级各减1秒展开为1、6、11、16级对应6/6/5/4/3秒中的有效门槛值；李青P能量回复由10起点及7/13级各增5展开为10/15/20，第一次攻击再乘2。这里只记录来源断点和运行输入，不伪造完整角色等级公式。",
  selectorEvidence: [
    { path: "数据参考/全量录入-2026-09/交叉试录/最大生命属性回补/独立来源补证/README.md", note: "同版mStat12且省略mStatFormula的窄证映射为SOURCE.hp.TOTAL；不扩展至BONUS。" },
    { path: "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第二十四批/范围与体验报告.md", note: "同版mStat12/mStatFormula2当前正文窄证映射为来源额外生命，供斯卡纳Q的BONUS选择器使用。" },
    { path: ".agents/artifacts/hero35-luna-candidate/修订一/完整候选.json", note: "Braum Q同版mStat12无公式字段已按SOURCE.hp.TOTAL保存。" },
    { path: ".agents/artifacts/hero37-luna-candidate/修订一/修订差异.json", note: "Briar W/E同版无选择器mStat12按SOURCE.hp.TOTAL保存。" },
  ],
  range: "唯一敌方英雄一对一；保留自身护盾、自身属性、同技能两段和同目标多次伤害，第三友军、额外敌人、兵野专用、视野和未消费旧树列为排除或待接。",
  resources: "嘉文、斯卡纳、凯尔使用法力；李青使用能量并以energy属性和RESOURCE_CHANGE消耗表达，不改成法力。",
  timing: "只录当前根spellCastTime或当前正文直接消费的持续值；与mCastTime冲突或缺少实际事件证据的时序不擅自合并。",
};

const candidate = {
  meta: {
    generatedAt: new Date().toISOString(),
    batch,
    revision,
    status: "候选已生成，等待主负责人审查；未调用业务接口",
    gameId: "lol",
    apiBase,
    sourceVersion,
    scope: "嘉文四世、李青、斯卡纳、凯尔20个技能槽；唯一敌方英雄一对一。仅保存当前根绑定正文消费且来源明确的参数、实际二元公式、基础资源消耗和自身护盾/属性变化。",
    sourcePolicy: "固定客户端16.17、官方16.17.1与当前mLocKeys绑定正文/计算树；未知属性选择器、角色等级曲线、目标资格和事件时序不猜、不设默认。",
    inputPackage: ".agents/artifacts/hero38-root-entry-20260910",
    currentSnapshot: "输入包/参考资料/当前20槽保护快照.json",
    currentSnapshotSha256: sha256File(snapshotPath),
    sourceInputSha256: sha256File(inputVersionPath),
    sourceBindingSha256: sha256File(bindingPath),
    sourceReview,
    businessWrites: 0,
    apiCalls: 0,
    tokenStored: false,
    candidateFileSha256: null,
  },
  skills,
  order,
  reusedPublicParameters,
  reusedExistingParameters: reusedPublicParameters,
  counts,
  apiWrites: 0,
  sourceFiles,
  sourceNotes,
  protectedObjects,
};
const candidateBytes = JSON.stringify(candidate, null, 2) + "\n";
const candidateSha256 = sha256(candidateBytes);

const protectedRoutes = [
  "/attributes", "/skill-categories", "/modifier-zones", "/damage-types",
  ...["champion_jarvaniv", "champion_leesin", "champion_skarner", "champion_kayle"].flatMap(characterKey => [
    `/characters/${characterKey}`,
    `/character-skill-relations?characterKey=${characterKey}`,
  ]),
  ...order.flatMap(skillKey => [
    `/skills/${skillKey}`,
    `/skills/${skillKey}/representative-image`,
    `/skills/${skillKey}/parameters`,
    `/skills/${skillKey}/formulas`,
    `/skills/${skillKey}/effects`,
    `/skills/${skillKey}/processes`,
    `/skills/${skillKey}/internal-states`,
    `/skills/${skillKey}/trigger-rules`,
  ]),
];
const plan = {
  generatedAt: new Date().toISOString(),
  status: "仅写入意图，未调用业务接口；候选等待主负责人审查",
  batch,
  revision,
  apiBase,
  sourceVersion,
  candidateSha256,
  sourceInputSha256: sha256File(inputVersionPath),
  sourceBindingSha256: sha256File(bindingPath),
  sourceReview,
  protectionSnapshotSha256: sha256File(snapshotPath),
  publicReuseSha256: sha256File(reusePath),
  requestCount,
  requestCounts,
  currentTotalComponents: requestCount + reuse.length,
  currentCompositionListsProtected: 120,
  reusedPublicParameters,
  protectedSkills: order,
  protectedCounts: protectedObjects.protectedReferenceCounts,
  protectedRoutes,
  requests,
  noApiCalls: true,
  apiWrites: 0,
};
const planBytes = JSON.stringify(plan, null, 2) + "\n";
const planSha256 = sha256(planBytes);

const sourceValues = {
  generatedAt: new Date().toISOString(),
  batch,
  revision,
  status: "独立源值摘要，未调用业务接口",
  sourceVersion,
  sourceInputSha256: sha256File(inputVersionPath),
  sourceBindingSha256: sha256File(bindingPath),
  sourceReview,
  inputIntegrity,
  selectedValues: Object.fromEntries(order.map(skillKey => [skillKey, {
    binding: skills[skillKey].source.spellPath,
    officialMaxRank: skills[skillKey].maxLevel,
    rawDataValues: skills[skillKey].source.raw.dataValues,
    rawEffectAmount: skills[skillKey].source.raw.mEffectAmount,
    calculations: skills[skillKey].source.raw.calculations,
    selectedParameters: writes[skillKey].parameters.map(item => ({ parameterKey: item.parameterKey, valueType: item.valueType, valueMode: item.valueMode, fixedValue: item.fixedValue, levelValues: item.levelValues })),
    formulas: writes[skillKey].formulas.map(item => ({ formulaKey: item.formulaKey, expression: item.expression, sourceCalculationNames: formulaSources[skillKey]?.[item.formulaKey] || [] })),
    excluded: excluded[skillKey],
    pending: pending[skillKey],
  }])),
  scope: Object.fromEntries(order.map(skillKey => [skillKey, { excluded: excluded[skillKey], pending: pending[skillKey] }])),
  noApiCalls: true,
};
const sourceValuesBytes = JSON.stringify(sourceValues, null, 2) + "\n";
const sourceValuesSha256 = sha256(sourceValuesBytes);

const sourceScope = {
  generatedAt: new Date().toISOString(),
  batch,
  revision,
  status: "候选阶段，未调用业务接口",
  sourceVersion,
  sourceInputSha256: sha256File(inputVersionPath),
  sourceBindingSha256: sha256File(bindingPath),
  sourceReview,
  included: [
    "嘉文四世：战争律动当前生命比例与角色等级冷却端点；Q/W/E/R主树、军旗连接击飞时长、军旗自身攻速、护盾与竞技场时长。",
    "李青：疾风骤雨两次能量回复；Q首段、再施放和正文消费的最高值树；W自身护盾/全能吸血；E首段伤害/再施放减速；R仅主目标伤害。",
    "斯卡纳：战栗最大生命比例端点；Q强化攻击、最后一次最大生命比例和减速；W自身护盾/地震伤害；E撞墙伤害；R单一英雄伤害和命中后自身移速。",
    "凯尔：登神长阶门槛、层数、自身移速和焰浪；Q/W伤害、治疗、移速；E被动与主动已损生命比例；R敌方伤害和友方英雄无敌持续。",
  ],
  oneVsOneIrrelevant: [
    "第三友军收益、额外敌人独立事件、兵野专用封顶、视野/碰撞几何结果和未消费模式/匿名树。",
  ],
  unknownTimingOrCurve: [
    "角色等级断点中间曲线、目标最大/当前/额外生命输入、李青Q已损生命中间曲线、触发资格、碰撞与周期事件。",
  ],
  perSkill: Object.fromEntries(order.map(skillKey => [skillKey, { excluded: excluded[skillKey], pending: pending[skillKey] }])),
  counts,
  requestCount,
  publicReuse: reuse.length,
  protectedSummary: protectedObjects.protectedReferenceCounts,
  hashes: { candidateSha256, planSha256, sourceValuesSha256 },
  noApiCalls: true,
};

const experience = [
  "# 第三十八批体验记录",
  "",
  "本批只生成静态候选和请求意图，未调用业务接口。体验记录用于主负责人保存前复核。",
  "",
  "- 嘉文四世：W护盾的基础值、命中英雄额外护盾和减速分开；E保留军旗自身攻击速度，友军光环不在一对一范围建立结果。",
  "- 李青：能量与法力严格分开；Q首段/再施放和最高值树分开，已损生命中间曲线缺少计算树；R只保存一对一主目标伤害，碰撞额外生命支路排除。",
  "- 斯卡纳：Q的冷却虽有不消耗旗标仍按根等级数组录入，且下3次攻击单独记录；P角色等级插值只留端点与运行输入；E只在撞墙事件成立时应用伤害。",
  "- 凯尔：角色等级进阶保留在被动同一槽；W治疗/移速是数值公式，R友方英雄资格不由范围半径推断；E主动0.01倍率和百分数显示分开。",
  "",
  "需要后续接线：目标属性实际输入、角色等级曲线、同技能多段/多目标事件、资源扣除时点、控制生命周期与未闭合的触发资格。",
  "",
].join("\n");

const readme = [
  "# 第三十八批候选",
  "",
  "本目录保存嘉文四世、李青、斯卡纳、凯尔20个技能槽的静态候选。来源固定客户端16.17、官方资料16.17.1和当前根绑定正文；Cursor只读来源复核为READY，输入阶段197条GET、业务写入为0。",
  "",
  "当前保护快照中的20个主体、120项六类组成、20张代表图、4个角色及关系、四类公共字典和25项公共参数均不更新。请求计划只包含新增参数、公式和效果意图，公共冷却/消耗参数只复用。",
  "",
  "李青的资源是能量；斯卡纳Q冷却从根等级数组新增保存，mDoesNotConsumeCooldown不覆盖基础值。J4W与斯卡纳W/E的mStat12按同版窄证映射来源生命总值，斯卡纳Q按同版窄证映射来源额外生命；剩余角色等级运行输入不设默认值。所有公式树的操作数均为两个，未知目标事件、第三友军、额外敌人和兵野专用分支列在来源与范围。",
  "",
  "文件入口：完整候选.json、请求计划.json、来源值摘要.json、来源与范围.json、独立数学核算.mjs、体验报告.md。候选是静态设计证据，不代表业务入库、页面验收或战斗运行。",
  "",
].join("\n");

writeText(path.join(artifactDir, "完整候选.json"), candidateBytes);
writeText(path.join(artifactDir, "请求计划.json"), planBytes);
writeText(path.join(artifactDir, "来源值摘要.json"), sourceValuesBytes);
writeJson(path.join(artifactDir, "来源与范围.json"), sourceScope);
writeText(path.join(artifactDir, "体验报告.md"), experience);
writeText(path.join(artifactDir, "README.md"), readme);
writeJson(path.join(artifactDir, "来源哈希汇总.json"), {
  generatedAt: new Date().toISOString(),
  batch,
  revision,
  inputPackage: ".agents/artifacts/hero38-root-entry-20260910",
  sourceFiles,
  inputIntegrity,
  frozenHashes: {
    inputVersionSha256: sha256File(inputVersionPath),
    sourceBindingSha256: sha256File(bindingPath),
    protectionSnapshotSha256: sha256File(snapshotPath),
    publicReuseSha256: sha256File(reusePath),
    attributeBoundarySha256: sha256File(attributeBoundaryPath),
    payloadSampleSha256: sha256File(payloadSamplePath),
    cursorReviewSha256: sourceReview.conclusionSha256,
    cursorAuditSha256: sourceReview.auditSha256,
    cursorInputManifestSha256: sourceReview.inputManifestSha256,
  },
  outputs: { candidateSha256, planSha256, sourceValuesSha256 },
  apiCalls: 0,
  apiWrites: 0,
});
writeJson(path.join(artifactDir, "候选版本.json"), {
  generatedAt: new Date().toISOString(),
  batch,
  revision,
  status: "candidate",
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  counts,
  requestCount,
  sourceReview,
  apiCalls: 0,
  apiWrites: 0,
});

// 持久目录只接收本批候选材料，且复制后用字节校验，不写输入包或其它批次。
const durableFiles = ["完整候选.json", "请求计划.json", "来源值摘要.json", "来源与范围.json", "来源哈希汇总.json", "候选版本.json", "README.md", "体验报告.md"];
for (const file of durableFiles) {
  fs.mkdirSync(durableDir, { recursive: true });
  fs.copyFileSync(path.join(artifactDir, file), path.join(durableDir, file));
  assert(sha256File(path.join(artifactDir, file)) === sha256File(path.join(durableDir, file)), "持久文件复制字节不一致", file);
}

console.log(JSON.stringify({ batch, revision, counts, requestCount, candidateSha256, planSha256, sourceValuesSha256, sourceReview, protectedCounts: protectedObjects.protectedReferenceCounts, apiCalls: 0, apiWrites: 0 }, null, 2));
