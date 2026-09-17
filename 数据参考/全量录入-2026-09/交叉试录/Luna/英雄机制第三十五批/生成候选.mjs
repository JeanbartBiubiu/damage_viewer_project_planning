import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(ROOT, "输入包");
const BATCH = "英雄机制第三十五批";
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const readInput = (file) => JSON.parse(fs.readFileSync(path.join(INPUT, file), "utf8"));
const writeJson = (file, value) => fs.writeFileSync(path.join(ROOT, file), JSON.stringify(value, null, 2) + "\n", "utf8");
const writeText = (file, value) => fs.writeFileSync(path.join(ROOT, file), value, "utf8");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fileSha = (file) => sha(fs.readFileSync(path.join(INPUT, file)));
const clean = (value) => typeof value === "number" ? Number(value.toFixed(8)) : value;
const ms = (seconds) => {
  const value = Math.round(Number(seconds) * 1000);
  if (!Number.isInteger(value)) throw new Error("毫秒换算不是整数");
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
  "braum_p", "braum_q", "braum_w", "braum_e", "braum_r",
  "rell_p", "rell_q", "rell_w", "rell_e", "rell_r",
  "taric_p", "taric_q", "taric_w", "taric_e", "taric_r",
  "tahmkench_p", "tahmkench_q", "tahmkench_w", "tahmkench_e", "tahmkench_r",
];
const heroIds = { braum: "Braum", rell: "Rell", taric: "Taric", tahmkench: "TahmKench" };
const heroById = (id) => binding.heroes.find((hero) => hero.id === id);
const heroOf = (skillKey) => heroIds[skillKey.split("_")[0]];
const slotOf = (skillKey) => skillKey.split("_")[1].toUpperCase();
const bound = (skillKey) => {
  const hero = heroById(heroOf(skillKey));
  const skill = hero?.skills.find((item) => item.skillKey === skillKey || item.slot === slotOf(skillKey));
  if (!hero || !skill) throw new Error("缺少来源绑定 " + skillKey);
  return { hero, skill, raw: skill.object.mSpell };
};
const data = (skillKey, name) => {
  const values = bound(skillKey).raw.DataValues?.find((item) => item.name === name)?.values;
  if (!values) throw new Error("缺少 DataValues " + skillKey + "/" + name);
  return values;
};
const at = (skillKey, name, index = 1) => clean(data(skillKey, name)[index]);
const skillValues = (skillKey, name, maxLevel, transform = clean) =>
  data(skillKey, name).slice(1, maxLevel + 1).map(transform);
const characterValues = (skillKey, name) => data(skillKey, name).slice(1, 19).map(clean);
const calc = (skillKey, name) => bound(skillKey).raw.mSpellCalculations?.[name] || null;
const calculationCharacterValues = (skillKey, name) => {
  const part = calc(skillKey, name)?.mFormulaParts?.find((item) => Array.isArray(item.values));
  if (!part) throw new Error("缺少角色等级计算数组 " + skillKey + "/" + name);
  return part.values.slice(1, 19).map(clean);
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
  const clientFile = "参考资料/客户端原文/" + hero.id + ".json.gz";
  const officialZhFile = "参考资料/官方中文/" + hero.id + ".json";
  const officialEnFile = "参考资料/官方英文/" + hero.id + ".json";
  const field = (name) => raw[name] === undefined ? null : raw[name];
  return {
    hero: hero.id,
    heroName: hero.name,
    heroKey: hero.key,
    slot: slotOf(skillKey),
    resourceType: hero.source.resourceType,
    rootPath: hero.source.rootPath,
    spellPath: skill.binding,
    bindingAvailable: true,
    clientFile,
    clientSha256: hero.source.client.sha256,
    clientCompressedSha256: fileSha(clientFile),
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
    currentTextPath: "来源绑定与当前文本.json -> " + hero.id + "/" + slotOf(skillKey) + "/currentTexts",
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
const fixed = (key, name, type, value, description, sortOrder) =>
  parameter(key, name, type, "FIXED", value, null, description, sortOrder);
const levels = (key, name, type, values, description, sortOrder) =>
  parameter(key, name, type, "SKILL_LEVEL", null, values, description, sortOrder);
const character = (key, name, type, values, description, sortOrder) =>
  parameter(key, name, type, "CHARACTER_LEVEL", null, values, description, sortOrder);
const runtime = (key, name, type, description, sortOrder) =>
  parameter(key, name, type, "RUNTIME_INPUT", null, null, description, sortOrder);
const P = (parameterKey) => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const add = (left, right) => O("ADD", left, right);
const sub = (left, right) => O("SUBTRACT", left, right);
const mul = (left, right) => O("MULTIPLY", left, right);
const formula = (formulaKey, name, expression, description, sortOrder) => ({
  formulaKey,
  name,
  expression,
  description,
  sortOrder,
});
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const SOURCE_HP_TOTAL = () => A("SOURCE", "hp", "TOTAL");
const SOURCE_HP_BONUS = () => A("SOURCE", "hp", "BONUS");
const SOURCE_ARMOR_TOTAL = () => A("SOURCE", "armor", "TOTAL");
const SOURCE_ARMOR_BONUS = () => A("SOURCE", "armor", "BONUS");
const SOURCE_MR_TOTAL = () => A("SOURCE", "magic_resistance", "TOTAL");
const SOURCE_MR_BONUS = () => A("SOURCE", "magic_resistance", "BONUS");
const TARGET_HP_TOTAL = () => A("TARGET", "hp", "TOTAL");
const put = (skillKey, parameters, formulas, effects, excludedItems, pendingItems, proofNote) => {
  writes[skillKey] = {
    parameters,
    formulas,
    effects,
    processes: [],
    internalStates: [],
    triggerRules: [],
  };
  excluded[skillKey] = excludedItems;
  pending[skillKey] = pendingItems;
  notes[skillKey] = proofNote;
};
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
const permanentLifecycle = () => ({
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
const persistentBehavior = () => ({
  moment: "PERSISTENT",
  valueReadMode: "APPLICATION_SNAPSHOT",
  stackValueMode: "SHARED",
  reapplicationValueMode: "REPLACE",
  periodicExecutionMode: null,
});
const shieldEffect = (effectKey, name, value, lifecycle, description, sortOrder) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle,
  results: [{
    resultKey: "shield",
    name,
    resultType: "NORMAL_SHIELD",
    target: "SOURCE",
    description: "只定义来源明确的自身护盾数值；施放和移除事件由后续事件层接线。",
    sortOrder: 10,
    lifecycleBehavior: persistentBehavior(),
    spellShieldBlockScope: null,
    valueRule: {
      value,
      fixedMultiplier: 1,
      fixedMinValue: 0,
      fixedMaxValue: null,
    },
    detail: { absorbedDamageTypeKey: null, decayMode: "NONE" },
  }],
});

const writes = {};
const excluded = {};
const pending = {};
const notes = {};
const formulaSourceNames = {
  braum_p: { already_stunned_extra_magic_damage: ["TotalDamage", "OnHitDamage"] },
  braum_q: { magic_damage: ["TotalDamage"] },
  braum_w: { self_armor_bonus: ["GrantedBraumArmor"], self_magic_resistance_bonus: ["GrantedBraumMR"] },
  braum_r: { magic_damage: ["TotalDamage"] },
  rell_p: { on_hit_extra_magic_damage: ["OnHitDamage"] },
  rell_q: { magic_damage: ["Damage"] },
  rell_w: { crash_down_magic_damage: ["DismountDamage"], crash_shield_value: ["Shield"], mount_up_extra_attack_magic_damage: ["FlipDamage"] },
  rell_e: { next_hit_extra_magic_damage: ["MaxHealthDamageCalc"] },
  rell_r: { damage_per_second_magic: ["DamagePerSecond"], total_magic_damage: ["TotalDamage"] },
  taric_p: { empowered_attack_extra_magic_damage: ["TotalDamage"], basic_ability_cooldown_refund_seconds: ["CDR"] },
  taric_q: { healing_per_charge: ["HealingPerStack"], max_charge_healing: ["MaxStackHealing"], consumed_charge_healing: ["HealingPerStack", "MaxStackHealing"] },
  taric_w: { self_armor_bonus: ["BonusArmor"], self_shield_value: ["ShieldHPRatio"] },
  taric_e: { magic_damage: ["TotalDamage"] },
  tahmkench_p: { bonus_hp_magic_damage: ["TotalDamage"], ap_bonus_hp_magic_damage: ["TotalDamage"], total_passive_magic_damage: ["TotalDamage"] },
  tahmkench_q: { magic_damage: ["TotalDamage"], self_heal: ["PercentHealthHealing", "BaseHeal"] },
  tahmkench_w: { magic_damage: ["TotalDamage"] },
  tahmkench_e: { grey_health_maximum: ["GreyHealthMaximum"], grey_health_heal_value: ["GreyHealthHealingRatio"] },
  tahmkench_r: { target_max_hp_damage_ratio: ["PercentHPDamage"], enemy_magic_damage: ["PercentHPDamage"], actual_cooldown_ms: ["CDCalc"] },
};

// 布隆：被动保留完整角色等级伤害；阶梯时长只保存原始断点，不伪造求值器。
put("braum_p", [
  fixed("stack_window_ms", "震荡猛击层数窗口（毫秒）", "INTEGER", ms(at("braum_p", "StackDuration")), "客户端DataValues.StackDuration=4秒；转换为4000毫秒。", 10),
  fixed("max_stack_count", "震荡猛击最大层数", "INTEGER", at("braum_p", "StackCap"), "客户端DataValues.StackCap=4；第三友军叠层和事件资格不在此参数内。", 20),
  fixed("already_stunned_damage_ratio", "晕眩冷却期间普攻附伤比例", "DECIMAL", at("braum_p", "AlreadyStunnedDamageAmp"), "当前OnHitDamage树使用AlreadyStunnedDamageAmp=0.4；正文显示为TotalDamage的附加魔法伤害比例。", 30),
  character("total_magic_damage_by_character_level", "触发晕眩魔法伤害（按角色等级）", "INTEGER", calculationCharacterValues("braum_p", "TotalDamage"), "当前TotalDamage计算树含完整角色等级数组；取客户端索引1至18的26至196，不按端点猜曲线。", 40),
  fixed("stun_cooldown_base_ms", "晕眩后叠层封锁基础时间（毫秒）", "INTEGER", ms(calc("braum_p", "StunCD").mFormulaParts[0].mLevel1Value), "当前StunCD阶梯基础8秒；完整角色等级断点另存，不把断点展开为未知求值公式。", 50),
  fixed("stun_cooldown_reduction_ms", "晕眩后叠层封锁每次减少（毫秒）", "INTEGER", ms(Math.abs(calc("braum_p", "StunCD").mFormulaParts[0].mBreakpoints[0].mAdditionalBonusAtThisLevel)), "当前StunCD在6级、11级各减少2秒；参数取正的减少幅度。", 60),
  fixed("stun_cooldown_breakpoint_1_level", "晕眩后叠层封锁第一次断点等级", "INTEGER", calc("braum_p", "StunCD").mFormulaParts[0].mBreakpoints[0].mLevel, "当前StunCD第一断点为角色6级。", 70),
  fixed("stun_cooldown_breakpoint_2_level", "晕眩后叠层封锁第二次断点等级", "INTEGER", calc("braum_p", "StunCD").mFormulaParts[0].mBreakpoints[1].mLevel, "当前StunCD第二断点为角色11级。", 80),
  fixed("stun_duration_base_ms", "触发晕眩基础时间（毫秒）", "INTEGER", ms(calc("braum_p", "StunDuration").mFormulaParts[0].mLevel1Value), "当前StunDuration基础1.25秒；转换为1250毫秒。", 90),
  fixed("stun_duration_increase_ms", "触发晕眩每次增加（毫秒）", "INTEGER", ms(calc("braum_p", "StunDuration").mFormulaParts[0].mBreakpoints[0].mAdditionalBonusAtThisLevel), "当前StunDuration在7级、13级各增加0.25秒。", 100),
  fixed("stun_duration_breakpoint_1_level", "触发晕眩第一次断点等级", "INTEGER", calc("braum_p", "StunDuration").mFormulaParts[0].mBreakpoints[0].mLevel, "当前StunDuration第一断点为角色7级。", 110),
  fixed("stun_duration_breakpoint_2_level", "触发晕眩第二次断点等级", "INTEGER", calc("braum_p", "StunDuration").mFormulaParts[0].mBreakpoints[1].mLevel, "当前StunDuration第二断点为角色13级。", 120),
], [
  formula("already_stunned_extra_magic_damage", "晕眩冷却期间普攻额外魔法伤害", mul(P("total_magic_damage_by_character_level"), P("already_stunned_damage_ratio")), "当前OnHitDamage=TotalDamage×AlreadyStunnedDamageAmp；只保存附加组成，不自动创建普攻事件。", 10),
], [], [
  { item: "其他友军叠加层数", reason: "当前正文虽允许友军攻击叠层，本轮按单一来源与单一敌人，不建立第三友军事件。" },
  { item: "同一次攻击重复结算普通叠层与晕眩冷却附伤", reason: "当前正文将晕眩后冷却和正常叠层分开，事件层需保证一次命中只结算适用分支。" },
], [
  { item: "角色等级断点求值时点", reason: "保存了原始完整TotalDamage数组及StunCD/StunDuration断点；断点求值循环不在当前候选中猜测。" },
], "被动伤害沿当前根绑定TotalDamage/OnHitDamage树；完整角色等级数组可直接取值，阶梯时长只保留基础、增量和等级断点。");

put("braum_q", [
  levels("base_damage", "寒冬之咬基础魔法伤害", "INTEGER", skillValues("braum_q", "BaseDamage", 5), "客户端DataValues.BaseDamage取技能等级索引1至5的75/120/165/210/255。", 10),
  fixed("target_max_hp_ratio", "寒冬之咬目标最大生命比例", "DECIMAL", at("braum_q", "MaxHPDamageValue"), "当前TotalDamage的mStat12项使用MaxHPDamageValue=0.025；目标最大生命由目标属性输入提供。", 20),
  fixed("initial_slow_percent_points", "初始减速百分数点", "INTEGER", at("braum_q", "InitialSlow"), "正文直接显示InitialSlow%，保留70百分数点，不乘0.01。", 30),
  fixed("minimum_slow_percent_points", "最低减速百分数点", "INTEGER", at("braum_q", "MinSlow"), "客户端MinSlow=30且当前正文未显示该占位；只保留来源值，不拟合衰减曲线。", 40),
  fixed("slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", ms(at("braum_q", "SlowDuration")), "客户端SlowDuration=2秒；转换为2000毫秒。", 50),
], [
  formula("magic_damage", "寒冬之咬单一敌人魔法伤害", add(P("base_damage"), mul(P("target_max_hp_ratio"), TARGET_HP_TOTAL())), "当前TotalDamage=BaseDamage+MaxHPDamageValue×目标最大生命；命中第一名敌人，P叠层事件另行接线。", 10),
], [], [
  { item: "命中后自动施加震荡猛击", reason: "数值参数保留，叠层应用时点不是伤害公式，留给事件层。" },
  { item: "投射物距离与飞行时序", reason: "MissileRange等空间参数不进入本轮单一敌人伤害组成。" },
], [
  { item: "减速持续衰减曲线", reason: "当前只有InitialSlow、MinSlow和SlowDuration，未提供中间曲线。" },
  { item: "spellCastTime与mCastTime", reason: "当前根同时有0.38889998与0.25秒两个字段，存在来源冲突，不选默认施法时间。" },
], "Q的最大生命比例按当前TotalDamage树和目标总生命属性读取；百分数点和比例分别保存。");

put("braum_w", [
  levels("base_resistance", "挺身而出基础双抗", "INTEGER", skillValues("braum_w", "BaseResists", 5), "客户端BaseResists取技能等级索引1至5的20/25/30/35/40点；护甲和魔抗共用该基础值。", 10),
  fixed("self_resistance_ratio", "布隆自身双抗加成比例", "DECIMAL", at("braum_w", "BraumArmorPercent"), "当前GrantedBraumArmor/GrantedBraumMR均使用BraumArmorPercent=0.36。", 20),
  fixed("self_buff_duration_ms", "布隆自身双抗加成持续时间（毫秒）", "INTEGER", ms(at("braum_w", "Duration")), "客户端Duration=3秒；转换为3000毫秒。", 30),
], [
  formula("self_armor_bonus", "布隆自身护甲加成", add(P("base_resistance"), mul(P("self_resistance_ratio"), SOURCE_ARMOR_BONUS())), "当前GrantedBraumArmor=BaseResists+0.36×来源护甲阶段；mStat1/mStatFormula2按来源额外护甲属性读取。", 10),
  formula("self_magic_resistance_bonus", "布隆自身魔法抗性加成", add(P("base_resistance"), mul(P("self_resistance_ratio"), SOURCE_MR_BONUS())), "当前GrantedBraumMR=BaseResists+0.36×来源魔抗阶段；mStat6/mStatFormula2按来源额外魔抗属性读取。", 20),
], [], [
  { item: "友方目标的0.12双抗分支", reason: "第三友军收益超出本轮；不把AllyArmorPercent扩写为自身或无条件效果。" },
], [
  { item: "跃进目标资格", reason: "当前正文要求友方英雄或小兵作为目标；本轮保留布隆自身数值，但不自动施加自益效果。" },
  { item: "双抗属性阶段求值", reason: "来源树明确mStatFormula2，实际施加前属性快照和角色属性阶段由运行输入提供，禁止递归使用最终双抗。" },
], "W只保存布隆自身双抗树；友方分支排除，持续时间与施放资格不混成属性结果。");

put("braum_e", [
  levels("shield_hold_duration_ms", "举盾持续时间（毫秒）", "INTEGER", skillValues("braum_e", "ShieldHoldDuration", 5, (value) => ms(value)), "客户端ShieldHoldDuration取索引1至5的3/3.25/3.5/3.75/4秒，转换为整数毫秒。", 10),
  fixed("first_projectile_damage_ratio", "首个弹体伤害比例", "DECIMAL", 0, "当前正文明确举盾后的首个弹体不会造成伤害，保存为0比例；不把它扩展为所有来源无敌。", 20),
  levels("subsequent_damage_reduction_percent_points", "后续弹体伤害降低百分数点", "INTEGER", skillValues("braum_e", "ShieldFacingDRAmount", 5), "当前正文直接显示ShieldFacingDRAmount%，取索引1至5的35/40/45/50/55百分数点。", 30),
  fixed("self_move_speed_ratio", "举盾时自身移动速度比例", "DECIMAL", at("braum_e", "MoveSpeedPercent") / 100, "当前MoveSpeedPercent=10且正文显示10%；转为0.1比例，不映射为无证属性效果。", 40),
], [], [], [
  { item: "普通吸收量护盾、法术护盾或所有来源无敌", reason: "当前正文是拦截弹体并降低后续伤害，不是普通护盾或一次法术护盾。" },
  { item: "RangedReflect", reason: "当前根字段没有进入当前中文正文或计算树，保留在来源原文，不作为确定组成。" },
], [
  { item: "弹体资格、选定方向和伤害阶段", reason: "当前只证实首个弹体归零及后续百分数点减伤，实际拦截事件和方向判断待接。" },
], "E保留首个弹体归零、后续减伤百分数点、举盾时长和自身移速比例；不伪造护盾结果。");

put("braum_r", [
  levels("base_damage", "冰川裂隙基础魔法伤害", "INTEGER", skillValues("braum_r", "BaseDamage", 3), "客户端BaseDamage取技能等级索引1至3的150/250/350。", 10),
  fixed("ability_power_ratio", "冰川裂隙法强比例", "DECIMAL", 0.6, "当前TotalDamage树的StatByCoefficient系数为0.6×来源总法强。", 20),
  fixed("minimum_knockup_ms", "首目标最短击飞时间（毫秒）", "INTEGER", ms(at("braum_r", "MinKnockup")), "客户端MinKnockup=0.6秒；转换为600毫秒。", 30),
  levels("maximum_knockup_ms", "首目标最长击飞时间（毫秒）", "INTEGER", skillValues("braum_r", "MaxKnockup", 3, (value) => ms(value)), "客户端MaxKnockup取索引1至3的1/1.5/2秒，转换为1000/1500/2000毫秒。", 40),
  levels("slow_zone_duration_ms", "减速地带持续时间（毫秒）", "INTEGER", skillValues("braum_r", "SlowZoneDuration", 3, (value) => ms(value)), "客户端SlowZoneDuration=4秒；按技能等级保存原始数组并转换为4000毫秒。", 50),
  levels("slow_percent_points", "减速地带百分数点", "INTEGER", skillValues("braum_r", "MoveSpeedMod", 3), "正文直接显示MoveSpeedMod%，取技能等级索引1至3的40/50/60百分数点。", 60),
  fixed("slow_debuff_duration_ms", "离开地带减速残留时间（毫秒）", "INTEGER", ms(at("braum_r", "SlowDebuffDuration")), "客户端SlowDebuffDuration=0.25秒；转换为250毫秒。", 70),
], [
  formula("magic_damage", "冰川裂隙首目标魔法伤害", add(P("base_damage"), mul(P("ability_power_ratio"), AP())), "当前TotalDamage=BaseDamage+0.6×来源总法强；额外敌人击飞分支不建立伤害结果。", 10),
], [], [
  { item: "额外敌人的击飞", reason: "本轮按唯一敌人，只保留首目标伤害和控制时长范围。" },
  { item: "距离几何和MaxKnockupRatio", reason: "最长击飞随距离变化，但当前没有可复核插值函数，不建几何中转公式。" },
], [
  { item: "首目标距离到击飞时长的映射", reason: "仅保留最短、最长源值；距离插值规则未知。" },
], "R的伤害树明确；击飞范围、慢区时间和离开残留分开保存，距离插值不猜。");

// 芮尔：保留单一敌人伤害、自身护盾与形态数值，排除第三友军和兵野专用分支。
put("rell_p", [
  fixed("steal_ratio_per_stack", "每层偷取双抗比例", "DECIMAL", at("rell_p", "StealPercent"), "当前StealPercent=0.03，正文以StealPercent×100显示为3%；比例1代表100%。", 10),
  fixed("shred_duration_ms", "偷取双抗持续时间（毫秒）", "INTEGER", ms(at("rell_p", "ShredDuration")), "客户端ShredDuration=5秒；转换为5000毫秒。", 20),
  fixed("max_stack_count", "偷取双抗最大层数", "INTEGER", at("rell_p", "MaxStacks"), "客户端MaxStacks=5。", 30),
  fixed("max_steal_percent_points", "最大偷取双抗百分数点", "INTEGER", at("rell_p", "MaxPercentTooltipOnly"), "当前正文直接显示MaxPercentTooltipOnly%，保留15百分数点，不作为另一个倍率。", 40),
  runtime("steal_floor_by_character_level", "角色等级最低偷取值", "DECIMAL", "当前StealFloor是1.5到3的ByCharLevelInterpolation；中间等级算法未证，实际等级值由运行输入提供。", 50),
  runtime("current_stack_count", "当前偷取双抗层数", "INTEGER", "实际层数由运行输入提供，范围0至5；不默认满层，也不把自身已降低属性递归作为下一层输入。", 60),
  fixed("on_hit_armor_ratio", "普攻额外伤害护甲比例", "DECIMAL", clean(calc("rell_p", "OnHitDamage").mFormulaParts[0].mCoefficient), "当前OnHitDamage第一项为0.05×来源总护甲。", 70),
  fixed("on_hit_magic_resistance_ratio", "普攻额外伤害魔抗比例", "DECIMAL", clean(calc("rell_p", "OnHitDamage").mFormulaParts[1].mCoefficient), "当前OnHitDamage第二项为0.05×来源总魔法抗性。", 80),
], [
  formula("on_hit_extra_magic_damage", "普攻额外魔法伤害", add(mul(P("on_hit_armor_ratio"), SOURCE_ARMOR_TOTAL()), mul(P("on_hit_magic_resistance_ratio"), SOURCE_MR_TOTAL())), "当前OnHitDamage=0.05×来源总护甲+0.05×来源总魔抗；不自动扩展到所有技能。", 10),
], [], [
  { item: "小兵和史诗级野怪偷取分支", reason: "当前扩展正文明确不偷取小兵或史诗级野怪，且本轮按单一英雄范围。" },
  { item: "所有技能自动附加普攻伤害", reason: "当前详细树只明确OnHitDamage，不能因摘要文字把它自动附加到每个技能。" },
], [
  { item: "偷取属性快照与层间叠加", reason: "敌方属性快照、自身获得量和层数事件必须分开；不默认每层都对已降低的最终属性重复相乘。" },
  { item: "StealFloor实际等级曲线", reason: "保留1.5至3的运行输入，不把端点连成线性表。" },
], "P把偷取层数与普攻额外伤害分开；OnHitDamage只沿当前实际计算树，角色等级最低偷取值不猜插值。");

put("rell_q", [
  levels("base_damage", "裂阵基础魔法伤害", "INTEGER", skillValues("rell_q", "BaseDamage", 5), "客户端BaseDamage取技能等级索引1至5的60/100/140/180/220。", 10),
  fixed("ability_power_ratio", "裂阵法强比例", "DECIMAL", 0.6, "当前Damage树的StatByCoefficient系数为0.6×来源总法强。", 20),
  fixed("stun_duration_ms", "裂阵晕眩时间（毫秒）", "INTEGER", ms(at("rell_q", "StunDuration")), "客户端StunDuration=0.65秒；转换为650毫秒。", 30),
], [
  formula("magic_damage", "裂阵单一敌人魔法伤害", add(P("base_damage"), mul(P("ability_power_ratio"), AP())), "当前Damage=BaseDamage+0.6×来源总法强；护盾摧毁顺序由事件层保留。", 10),
], [], [
  { item: "野怪护盾摧毁", reason: "当前扩展正文明确不会打破野怪护盾，本轮目标是单一敌方英雄。" },
], [
  { item: "破盾与伤害事件顺序", reason: "正文同时给出摧毁护盾和伤害，当前只保存公式与晕眩时长，不造瞬时事件。" },
  { item: "spellCastTime与mCastTime", reason: "当前根同时有0.35与0.4秒字段，存在来源冲突，不选默认施法时间。" },
], "Q保留单一英雄魔法伤害和650毫秒晕眩；破盾顺序和施法字段冲突留待事件层与来源核对。");

put("rell_w", [
  levels("crash_down_base_damage", "轰落基础魔法伤害", "INTEGER", skillValues("rell_w", "CrashDownDamage", 5), "客户端CrashDownDamage取技能等级索引1至5的60/90/120/150/180。", 10),
  fixed("crash_down_ability_power_ratio", "轰落法强比例", "DECIMAL", 0.6, "当前DismountDamage树使用0.6×来源总法强。", 20),
  fixed("crash_knockup_duration_ms", "轰落击飞时间（毫秒）", "INTEGER", ms(at("rell_w", "CrashDownKnockupDuration")), "客户端CrashDownKnockupDuration=0.4秒；转换为400毫秒。", 30),
  fixed("crash_stun_duration_ms", "轰落晕眩时间（毫秒）", "INTEGER", ms(at("rell_w", "CrashDownStunDuration")), "客户端CrashDownStunDuration=0.8秒；转换为800毫秒，和击飞分开保存。", 40),
  levels("crash_shield_base", "轰落护盾基础值", "INTEGER", skillValues("rell_w", "ShieldBase", 5), "客户端ShieldBase取技能等级索引1至5的20/40/60/80/100。", 50),
  fixed("crash_shield_hp_ratio", "轰落护盾生命比例", "DECIMAL", at("rell_w", "ShieldHealthRatio"), "当前Shield=ShieldBase+0.11×来源最大生命；0.11为比例。", 60),
  levels("mounted_move_speed_points", "骑乘状态移动速度点数", "INTEGER", skillValues("rell_w", "MountedMoveSpeed", 5), "当前MountedMoveSpeed正文直接显示点数20/25/30/35/40，不映射为移动速度比例。", 70),
  fixed("resistance_increase_ratio", "披甲形态双抗提升比例", "DECIMAL", at("rell_w", "ResistanceIncrease"), "当前正文显示ResistanceIncrease×100%，保留0.15比例。", 80),
  fixed("dismounted_attack_speed_ratio", "披甲形态攻击速度比例", "DECIMAL", at("rell_w", "DismountedASBoost"), "当前正文显示DismountedASBoost×100%，保留0.2比例。", 90),
  fixed("dismounted_attack_range_points", "披甲形态攻击距离点数", "INTEGER", at("rell_w", "DismountedRangeBoost"), "当前DismountedRangeBoost=75，点数而非比例。", 100),
  levels("mount_up_extra_attack_base_damage", "上马后下次攻击额外基础魔法伤害", "INTEGER", skillValues("rell_w", "MountUpDamage", 5), "当前FlipDamage实际消费MountUpDamage，取索引1至5的10/25/40/55/70；不使用未消费FlipBaseDamage。", 110),
  fixed("mount_up_extra_attack_ability_power_ratio", "上马后下次攻击额外法强比例", "DECIMAL", clean(calc("rell_w", "FlipDamage").mFormulaParts[1].mCoefficient), "当前FlipDamage树使用0.4×来源总法强。", 120),
  fixed("mount_up_move_speed_ratio", "上马后衰减移动速度比例", "DECIMAL", at("rell_w", "MountUpSpeed"), "当前MountUpSpeed=0.3比例，衰减过程不凭匿名树拟合。", 130),
  fixed("mount_up_attack_window_ms", "上马后下次攻击窗口（毫秒）", "INTEGER", ms(at("rell_w", "MountUpSpeedDuration")), "当前MountUpSpeedDuration=3.5秒；转换为3500毫秒。", 140),
  fixed("flip_knockup_duration_ms", "上马后攻击击飞时间（毫秒）", "INTEGER", ms(at("rell_w", "FlipKnockupDuration")), "当前FlipKnockupDuration=0.4秒；转换为400毫秒。", 150),
  fixed("flip_stun_duration_ms", "上马后攻击晕眩时间（毫秒）", "INTEGER", ms(at("rell_w", "FlipStunDuration")), "当前FlipStunDuration=0.6秒；转换为600毫秒，不与击飞简单相加。", 160),
], [
  formula("crash_down_magic_damage", "轰落魔法伤害", add(P("crash_down_base_damage"), mul(P("crash_down_ability_power_ratio"), AP())), "当前DismountDamage=CrashDownDamage+0.6×来源总法强。", 10),
  formula("crash_shield_value", "轰落自身护盾值", add(P("crash_shield_base"), mul(P("crash_shield_hp_ratio"), SOURCE_HP_TOTAL())), "当前Shield=ShieldBase+ShieldHealthRatio×来源最大生命；护盾持续至再次上马。", 20),
  formula("mount_up_extra_attack_magic_damage", "上马后下次攻击额外魔法伤害", add(P("mount_up_extra_attack_base_damage"), mul(P("mount_up_extra_attack_ability_power_ratio"), AP())), "当前FlipDamage=MountUpDamage+0.4×来源总法强，绑定当前消费值而非FlipBaseDamage。", 30),
], [
  shieldEffect("dismount_shield", "披甲形态自身护盾", { kind: "FORMULA", formulaKey: "crash_shield_value" }, permanentLifecycle(), "当前正文明确护盾持续到再次上马；使用显式移除生命周期，不虚构固定秒数。施放与再次上马事件待接。", 40),
], [
  { item: "PercentageOfBuffNameElapsed匿名衰减树", reason: "当前树没有稳定可读的技能参数消费者，不能把匿名缓冲时间替换成固定衰减曲线。" },
  { item: "SlideDistance空间距离", reason: "只作位移空间数据，不进入本轮数值组成。" },
], [
  { item: "骑乘与披甲转换事件", reason: "W保留两个形态分支和自身护盾；切换资格、形态状态和控制事件不自动创建。" },
  { item: "轰落击飞与晕眩重叠", reason: "0.4秒击飞和0.8秒晕眩分别保存，当前没有证据要求相加。" },
], "W不是整套技能变形；轰落、护盾、披甲属性和上马攻击分支分别保存，护盾采用持续至再次上马的显式移除生命周期。");

put("rell_e", [
  fixed("self_move_speed_ratio", "全速冲锋自身移动速度比例", "DECIMAL", at("rell_e", "MinMS"), "当前MinMS=0.15，正文显示15%；保留自身收益。", 10),
  fixed("toward_enemy_move_speed_ratio", "朝敌方英雄移动速度比例", "DECIMAL", at("rell_e", "MaxMS"), "当前MaxMS=0.3，正文显示30%；它是朝敌方英雄时的更高自益比例。", 20),
  fixed("self_move_speed_duration_ms", "全速冲锋持续时间（毫秒）", "INTEGER", ms(at("rell_e", "Duration")), "客户端Duration=3秒；转换为3000毫秒。", 30),
  levels("next_hit_target_max_hp_ratio", "下次攻击或Q目标最大生命比例", "DECIMAL", skillValues("rell_e", "PercentHealthDamage", 5), "当前MaxHealthDamageCalc使用PercentHealthDamage，取技能等级索引1至5的0.05至0.07比例。", 40),
  fixed("next_hit_ability_power_ratio", "下次攻击或Q法强比例", "DECIMAL", clean(calc("rell_e", "MaxHealthDamageCalc").mFormulaParts[1].mCoefficient), "当前MaxHealthDamageCalc第二项为0.0003×来源总法强；整个结果作为目标最大生命比例。", 50),
  fixed("cast_time_ms", "全速冲锋施法时间（毫秒）", "INTEGER", ms(bound("rell_e").raw.spellCastTime), "当前根只有spellCastTime=0.25秒可用；转换为250毫秒，仅保存来源字段。", 60),
], [
  formula("next_hit_extra_magic_damage", "下次攻击或Q额外魔法伤害", mul(add(P("next_hit_target_max_hp_ratio"), mul(P("next_hit_ability_power_ratio"), AP())), TARGET_HP_TOTAL()), "当前MaxHealthDamageCalc先计算PercentHealthDamage+0.0003×法强，再乘目标最大生命；普攻和Q不能同次重复消耗。", 10),
], [], [
  { item: "野怪与建筑伤害封顶", reason: "PercentHealthDamageCap是兵野/建筑专用支路，本轮单一敌方英雄不录。" },
  { item: "另一名友军收益", reason: "当前主动描述含芮尔与一名友军冲锋；本轮只保留自身移动速度与唯一敌人下一次命中组成。" },
], [
  { item: "下一次攻击或Q的消费事件", reason: "数值只定义一次额外命中；事件层需确保普攻与Q不会同次重复消费。" },
  { item: "非战斗移动速度摘要", reason: "当前根没有可用的对应数值，不能把空Phase2Start当成0。" },
], "E保留自身15%/30%移动速度、时间和单一敌人下一次命中比例；兵野上限与友军路径不录。");

put("rell_r", [
  levels("damage_per_second_base", "极涌每秒基础魔法伤害", "INTEGER", skillValues("rell_r", "BaseDamagePerSecond", 3), "客户端BaseDamagePerSecond取技能等级索引1至3的75/125/175。", 10),
  fixed("ability_power_ratio", "极涌每秒法强比例", "DECIMAL", clean(calc("rell_r", "DamagePerSecond").mFormulaParts[1].mCoefficient), "当前DamagePerSecond=BaseDamagePerSecond+0.55×来源总法强。", 20),
  fixed("duration_ms", "极涌持续时间（毫秒）", "INTEGER", ms(at("rell_r", "Duration")), "客户端Duration=2秒；转换为2000毫秒。", 30),
  fixed("duration_seconds", "极涌持续时间（秒，计算用）", "DECIMAL", at("rell_r", "Duration"), "TotalDamage树以Duration直接乘DamagePerSecond；保留2秒计算单位，不按未知跳数拆周期。", 40),
], [
  formula("damage_per_second_magic", "极涌每秒魔法伤害", add(P("damage_per_second_base"), mul(P("ability_power_ratio"), AP())), "当前DamagePerSecond树的单秒组成；拖曳与实际跳数事件待接。", 10),
  formula("total_magic_damage", "极涌持续期间总魔法伤害", mul(add(P("damage_per_second_base"), mul(P("ability_power_ratio"), AP())), P("duration_seconds")), "当前TotalDamage=DamagePerSecond×Duration=单秒式×2；不把持续时间当作伤害结果周期。", 20),
], [], [
  { item: "多名敌人额外收益", reason: "本轮按唯一敌人，不建立额外目标结果。" },
], [
  { item: "拉拽和持续拖曳时序", reason: "控制属于单一敌人，但当前没有可复核的每跳间隔；只保存单秒与总量公式。" },
  { item: "spellCastTime与mCastTime", reason: "当前根同时有0与0.25秒字段，存在来源冲突，不选默认施法时间。" },
], "R沿当前消费的DamagePerSecond和TotalDamage树，2秒总量明确；不把未知周期伪造为过程或每跳伤害。");

// 塔里克：保留自身数值、充能、护盾和唯一敌人伤害；友方复制与免疫资格待接。
put("taric_p", [
  fixed("empowered_attack_window_ms", "正气凌人强化攻击窗口（毫秒）", "INTEGER", ms(at("taric_p", "Duration")), "客户端Duration=5秒；转换为5000毫秒。", 10),
  fixed("empowered_attack_count", "正气凌人强化攻击次数", "INTEGER", 2, "当前正文明确施放技能后下2次攻击获得强化。", 20),
  fixed("empowered_attack_speed_ratio", "正气凌人强化攻击速度比例", "DECIMAL", 1, "当前正文明确100%攻击速度；保存为1比例，不自动创建攻击速度效果。", 30),
  runtime("character_level_base_damage", "正气凌人角色等级基础伤害", "DECIMAL", "当前TotalDamage含25至93的ByCharLevelInterpolation，完整中间等级算法未证，实际等级值由运行输入提供。", 40),
  fixed("mode_damage_multiplier", "正气凌人模式伤害系数", "DECIMAL", at("taric_p", "BaseDamageMultiplierForModesBalance"), "当前TotalDamage第一项使用BaseDamageMultiplierForModesBalance=1；只保留当前模式值。", 50),
  fixed("armor_damage_ratio", "正气凌人护甲伤害比例", "DECIMAL", at("taric_p", "ArmorDamageValue"), "当前TotalDamage第二项为0.15×来源额外护甲阶段。", 60),
  runtime("actual_armor_stage", "正气凌人实际护甲阶段", "DECIMAL", "当前TotalDamage使用mStat1/mStatFormula2；施放前额外护甲由运行输入提供，不递归使用强化后的护甲。", 70),
  runtime("actual_cooldown_multiplier", "基础技能实际冷却倍率", "DECIMAL", "当前CDR树消费CooldownMultiplierCalculationPart；实际倍率由运行输入提供，不默认1或0.5。", 80),
  fixed("cooldown_refund_base_seconds", "正气凌人冷却缩短基础项（秒）", "DECIMAL", 2, "当前CDR=1+(1-实际冷却倍率)，整理为2-实际冷却倍率；2是树中两个NumberCalculationPart的合计常数。", 90),
], [
  formula("empowered_attack_extra_magic_damage", "正气凌人强化普攻额外魔法伤害", add(mul(P("character_level_base_damage"), P("mode_damage_multiplier")), mul(P("armor_damage_ratio"), P("actual_armor_stage"))), "当前TotalDamage=角色等级基础值×模式系数+0.15×施放前护甲阶段；等级曲线和属性阶段外供。", 10),
  formula("basic_ability_cooldown_refund_seconds", "正气凌人基础技能冷却缩短（秒）", sub(P("cooldown_refund_base_seconds"), P("actual_cooldown_multiplier")), "当前CDR原树为1+(1-实际冷却倍率)，等价于2-实际冷却倍率；不简化为固定1秒。", 20),
], [], [
  { item: "自动强化两次普攻、自动减少基础技能冷却", reason: "只保存数值组成和窗口，普攻、技能施放与Q充能事件不自动创建。" },
], [
  { item: "角色等级基础伤害曲线", reason: "保留25至93端点为运行输入，不按端点插值。" },
  { item: "基础技能冷却减少的实际应用阶段", reason: "CDR树明确减少基础技能冷却，具体时点和Q充能联动待接。" },
], "P严格按TotalDamage和CDR计算树拆解；护甲阶段与冷却倍率均无默认输入。");

const taricHealingPerCharge = () => add(add(P("healing_per_charge_base"), mul(P("healing_ap_ratio"), AP())), mul(P("healing_hp_ratio"), SOURCE_HP_TOTAL()));
put("taric_q", [
  fixed("charge_interval_ms", "星光之触充能间隔（毫秒）", "INTEGER", ms(at("taric_q", "Recharge")), "当前StackCooldown消费Recharge=15秒；转换为15000毫秒，区别于已有cast_interval_ms=3000。", 10),
  fixed("charge_per_empowered_attack", "每次正气凌人强化攻击获得充能层数", "INTEGER", 1, "当前正文说明每次正气凌人攻击获得一层。", 20),
  fixed("healing_per_charge_base", "每层治疗基础值", "INTEGER", at("taric_q", "HealingPerStackBase"), "当前HealingPerStackBase=25。", 30),
  fixed("healing_ap_ratio", "每层治疗法强比例", "DECIMAL", at("taric_q", "HealingAPRatio"), "当前HealingPerStack使用0.15×来源总法强。", 40),
  fixed("healing_hp_ratio", "每层治疗最大生命比例", "DECIMAL", at("taric_q", "HealingHPRatio"), "当前HealingPerStack使用0.01×来源最大生命；不使用旧mEffectAmount中的0.75等值。", 50),
  levels("max_charge_count", "最大充能层数", "INTEGER", skillValues("taric_q", "MaxCharges", 5), "当前MaxCharges取技能等级索引1至5的1/2/3/4/5。", 60),
  runtime("current_consumed_charge_count", "当前消耗充能层数", "INTEGER", "主动施放时的实际充能层数由运行输入提供，范围0至当前MaxCharges；不默认满层。", 70),
], [
  formula("healing_per_charge", "星光之触每层治疗", taricHealingPerCharge(), "当前HealingPerStack=25+0.15×来源总法强+0.01×来源最大生命。", 10),
  formula("max_charge_healing", "星光之触满层治疗", mul(taricHealingPerCharge(), P("max_charge_count")), "当前MaxStackHealing=HealingPerStack×MaxCharges；只作满层数值，不代表实际一定满层施放。", 20),
  formula("consumed_charge_healing", "星光之触实际消耗层数治疗", mul(taricHealingPerCharge(), P("current_consumed_charge_count")), "实际总量=每层治疗×实际消耗充能；当前充能数由运行输入提供。", 30),
], [], [
  { item: "附近第三友方治疗分配", reason: "当前正文为附近友方英雄，本轮只保留自身数值资格，第三友方收益不建立。" },
  { item: "旧mEffectAmount与BaseHealMax", reason: "当前HealingPerStack/MaxStackHealing树未消费旧0.75和BaseHealMax，保留在来源原文而不写入。" },
], [
  { item: "自身治疗资格与0层施放资格", reason: "当前正文目标和0层是否可施放尚未独立证明；数值与实际充能输入保留，不造无条件条件。" },
  { item: "正气凌人充能联动", reason: "已有cast_interval_ms是公共施放间隔，不等于充能恢复；P攻击事件待接。" },
], "Q把15秒充能、P强化攻击充能、每层式、满层式和实际消耗层数式分开；已有3秒施放间隔只复用，不新增。");

put("taric_w", [
  levels("armor_bonus_ratio", "坚毅壁垒自身护甲比例", "DECIMAL", skillValues("taric_w", "ArmorBonusPercentage", 5, (value) => clean(value)), "当前BonusArmor树使用ArmorBonusPercentage，取索引1至5的0.06/0.07/0.08/0.09/0.10比例。", 10),
  runtime("actual_armor_stage", "坚毅壁垒护甲阶段", "DECIMAL", "当前BonusArmor使用来源护甲阶段；实际施加前属性由运行输入提供，禁止用最终护甲递归反馈。", 20),
  levels("self_shield_hp_ratio", "坚毅壁垒自身护盾最大生命比例", "DECIMAL", skillValues("taric_w", "ShieldHPRatio", 5, (value) => clean(value / 100)), "当前正文直接显示ShieldHPRatio%，原始值7至11是百分数点，转换为0.07至0.11比例。", 30),
  fixed("self_shield_duration_ms", "坚毅壁垒自身护盾持续时间（毫秒）", "INTEGER", ms(at("taric_w", "ShieldDuration")), "当前ShieldDuration=2.5秒；转换为2500毫秒。", 40),
], [
  formula("self_armor_bonus", "坚毅壁垒自身护甲加成", mul(P("armor_bonus_ratio"), P("actual_armor_stage")), "当前BonusArmor=ArmorBonusPercentage×来源护甲阶段；属性读取采用施加前快照。", 10),
  formula("self_shield_value", "坚毅壁垒自身护盾值", mul(P("self_shield_hp_ratio"), SOURCE_HP_TOTAL()), "当前正文护盾值为7/8/9/10/11%最大生命；只保留自身数值候选。", 20),
], [], [
  { item: "第三友方灵链复制", reason: "当前正文明确绑定友方并复制技能，本轮不建立第三友方复制效果或叠加。" },
], [
  { item: "自身护盾资格", reason: "当前正文的主动目标是友方英雄；保留自身数值和时长，但不自动挂接护盾效果。" },
  { item: "护甲阶段和灵链距离", reason: "护甲阶段与绑定距离由运行输入和事件层提供，不能递归或固定成默认值。" },
], "W的被动护甲和主动护盾分别成式；原始ShieldHPRatio是百分数点，公式使用正比例。");

put("taric_e", [
  levels("base_damage", "炫光基础魔法伤害", "INTEGER", skillValues("taric_e", "BaseDamage", 5), "客户端BaseDamage取技能等级索引1至5的90/130/170/210/250。", 10),
  fixed("ability_power_ratio", "炫光法强比例", "DECIMAL", clean(calc("taric_e", "TotalDamage").mFormulaParts[1].mCoefficient), "当前TotalDamage第二项使用0.5×来源总法强。", 20),
  runtime("actual_armor_stage", "炫光实际护甲阶段", "DECIMAL", "当前TotalDamage第三项为mStat1/mStatFormula2×0.5；施法时来源额外护甲由运行输入提供。", 30),
  fixed("armor_damage_ratio", "炫光护甲比例", "DECIMAL", clean(calc("taric_e", "TotalDamage").mFormulaParts[2].mCoefficient), "当前TotalDamage第三项使用0.5×来源额外护甲阶段。", 40),
  fixed("charge_duration_ms", "炫光准备时间（毫秒）", "INTEGER", ms(at("taric_e", "ChargeDuration")), "客户端ChargeDuration=1秒；转换为1000毫秒。", 50),
  fixed("stun_duration_ms", "炫光晕眩时间（毫秒）", "INTEGER", ms(at("taric_e", "StunDuration")), "客户端StunDuration=1.5秒；转换为1500毫秒。", 60),
], [
  formula("magic_damage", "炫光单一敌人魔法伤害", add(add(P("base_damage"), mul(P("ability_power_ratio"), AP())), mul(P("armor_damage_ratio"), P("actual_armor_stage"))), "当前tooltipOnly TotalDamage=BaseDamage+0.5×来源总法强+0.5×来源额外护甲；tooltipOnly不等于未消费。", 10),
], [], [
  { item: "同一敌人的复制叠加", reason: "复制技能的友方灵链分支不在本轮建立。" },
], [
  { item: "准备结束后的命中事件", reason: "只保存1秒准备和1.5秒晕眩，实际命中时点留给事件层。" },
  { item: "护甲阶段实际值", reason: "mStatFormula2的具体属性阶段由运行输入提供，不猜成最终护甲。" },
], "E沿当前完整TotalDamage树保存单一敌人魔法伤害；准备和控制时间独立记录。");

put("taric_r", [
  fixed("initial_delay_ms", "宇宙之辉初始延迟（毫秒）", "INTEGER", ms(at("taric_r", "InitialDelay")), "客户端InitialDelay=2.5秒；转换为2500毫秒。", 10),
  fixed("damage_immunity_duration_ms", "宇宙之辉伤害免疫持续时间（毫秒）", "INTEGER", ms(at("taric_r", "InvulnDuration")), "客户端InvulnDuration=2.5秒；转换为2500毫秒。当前不是护盾吸收量。", 20),
], [], [], [
  { item: "第三友方伤害免疫", reason: "当前正文明确附近友方英雄方向，本轮不建立第三友方目标效果。" },
], [
  { item: "自身伤害免疫资格与触发", reason: "自身路径保留时间和条件说明，但当前没有独立施放资格与触发时点证据。" },
], "R只保存2.5秒延迟与2.5秒伤害免疫时间；不将免疫改写为护盾，也不自动建立友方结果。");

// 塔姆：保留单一敌人、战前灰血和资源输入；增强敌人及友方吞噬分支排除。
put("tahmkench_p", [
  fixed("stack_window_ms", "培养品味层数持续时间（毫秒）", "INTEGER", ms(at("tahmkench_p", "Duration")), "客户端Duration=5秒；转换为5000毫秒。", 10),
  fixed("max_stack_count", "培养品味最大层数", "INTEGER", at("tahmkench_p", "MaxStacks"), "客户端MaxStacks=3。", 20),
  fixed("per_stack_decay_ms", "培养品味每层衰减间隔（毫秒）", "INTEGER", ms(at("tahmkench_p", "PerStackDecayTimer")), "客户端PerStackDecayTimer=1秒；转换为1000毫秒。", 30),
  runtime("character_level_base_damage", "培养品味角色等级基础伤害", "DECIMAL", "当前TotalDamage含角色等级起点5、每级增加5及12级断点增加5；完整断点求值算法未证，实际角色等级值由运行输入提供。", 40),
  fixed("bonus_hp_damage_ratio", "培养品味额外生命伤害比例", "DECIMAL", clean(calc("tahmkench_p", "TotalDamage").mFormulaParts[1].mCoefficient), "当前TotalDamage第二项是0.04×来源额外生命值，不能改成总生命值。", 50),
  fixed("ap_ratio_per_100_bonus_hp", "每100额外生命法强比例", "DECIMAL", at("tahmkench_p", "APRatioPer100BonusHP"), "当前APRatioPer100BonusHP=0.0125；根树另乘0.01把每100额外生命换成比例。" , 60),
  fixed("percent_to_ratio", "百分数点转比例", "DECIMAL", 0.01, "当前TotalDamage的AP额外生命子树明确使用0.01换算；不省略第二次比例因子。", 70),
  runtime("current_stack_count", "当前培养品味层数", "INTEGER", "实际目标层数由运行输入提供，范围0至3；Q/R强化资格不默认满足。", 80),
], [
  formula("bonus_hp_magic_damage", "培养品味额外生命魔法伤害", mul(P("bonus_hp_damage_ratio"), SOURCE_HP_BONUS()), "当前TotalDamage额外生命项=0.04×来源额外生命值。", 10),
  formula("ap_bonus_hp_magic_damage", "培养品味法强额外生命魔法伤害", mul(mul(mul(P("ap_ratio_per_100_bonus_hp"), AP()), P("percent_to_ratio")), SOURCE_HP_BONUS()), "当前TotalDamage子树保留法强×额外生命×0.0125×0.01，两个比例因子均进入最终公式。", 20),
  formula("total_passive_magic_damage", "培养品味普攻额外魔法伤害", add(add(P("character_level_base_damage"), mul(P("bonus_hp_damage_ratio"), SOURCE_HP_BONUS())), mul(mul(mul(P("ap_ratio_per_100_bonus_hp"), AP()), P("percent_to_ratio")), SOURCE_HP_BONUS())), "当前TotalDamage=角色等级基础值+0.04×额外生命+法强×额外生命×0.0125×0.01；基础等级值由运行输入包含断点结果。", 30),
], [], [
  { item: "完整等级断点中间值", reason: "ByCharLevelBreakpoints的构造字段明确但求值循环未证，不把起点和断点手工展开成角色等级表。" },
], [
  { item: "培养品味叠层触发", reason: "保留层数窗口、上限、衰减和当前层数输入；普攻、Q、R的叠层事件不自动接线。" },
  { item: "角色等级基础值", reason: "当前基础项含12级额外断点，实际值无默认输入。" },
], "P严格保留当前TotalDamage树的额外生命阶段和AP双比例；不以技能摘要中的总生命文字覆盖当前计算树。");

put("tahmkench_q", [
  levels("base_damage", "巨舌鞭笞基础魔法伤害", "INTEGER", skillValues("tahmkench_q", "BaseDamage", 5), "客户端BaseDamage取技能等级索引1至5的75/120/165/210/255。", 10),
  fixed("ability_power_ratio", "巨舌鞭笞法强比例", "DECIMAL", clean(calc("tahmkench_q", "TotalDamage").mFormulaParts[1].mCoefficient), "当前TotalDamage=BaseDamage+1.0×来源总法强。", 20),
  fixed("slow_ratio", "巨舌鞭笞减速比例", "DECIMAL", at("tahmkench_q", "SlowAmount"), "当前SlowAmount=0.5，正文按SlowAmount×100显示为50%。", 30),
  fixed("slow_duration_ms", "巨舌鞭笞减速持续时间（毫秒）", "INTEGER", ms(at("tahmkench_q", "SlowDuration")), "客户端SlowDuration=2秒；转换为2000毫秒。", 40),
  fixed("stun_duration_ms", "三层培养品味晕眩时间（毫秒）", "INTEGER", ms(at("tahmkench_q", "StunDuration")), "客户端StunDuration=1.5秒；转换为1500毫秒。", 50),
  levels("self_heal_base", "巨舌鞭笞自身治疗基础值", "INTEGER", skillValues("tahmkench_q", "BaseHeal", 5), "客户端BaseHeal取索引1至5的10/15/20/25/30。", 60),
  levels("self_heal_missing_hp_ratio", "巨舌鞭笞已损生命治疗比例", "DECIMAL", skillValues("tahmkench_q", "PercentHealthHealing", 5), "当前正文显示PercentHealthHealing×100%已损生命，取技能等级索引1至5的0.05至0.07比例。", 70),
  runtime("target_stack_count_before_hit", "命中前目标培养品味层数", "INTEGER", "命中前层数由运行输入提供，范围0至3；新增层数和三层消耗是不同事件。", 80),
  fixed("required_stack_count", "三层强化所需层数", "INTEGER", 3, "当前正文明确目标已有3层时触发晕眩并消耗层数。", 90),
  runtime("cast_stage_missing_hp", "施放阶段自身已损生命", "DECIMAL", "自身治疗按施放阶段已损生命读取，不能把缺少生命默认成0。", 100),
], [
  formula("magic_damage", "巨舌鞭笞单一敌人魔法伤害", add(P("base_damage"), mul(P("ability_power_ratio"), AP())), "当前TotalDamage=BaseDamage+1.0×来源总法强；命中英雄的P额外伤害属于跨技能分支，留待接线。", 10),
  formula("self_heal", "巨舌鞭笞自身治疗", add(P("self_heal_base"), mul(P("self_heal_missing_hp_ratio"), P("cast_stage_missing_hp"))), "当前正文为BaseHeal+PercentHealthHealing×施放阶段已损生命；治疗不是伤害公式的默认结果。", 20),
], [], [
  { item: "命中英雄额外一次培养品味伤害", reason: "这是P与Q的跨技能联动；本轮只保存Q自身TotalDamage和治疗式，不复制P公式。" },
  { item: "三层期间远处Q接R吞噬", reason: "这是Q/R跨技能时序分支，保留在来源说明，不造自动吞噬。" },
], [
  { item: "命中前层数判定与新增层数", reason: "必须先读取命中前层数，再决定晕眩和消耗；当前仅保存输入边界。" },
  { item: "spellCastTime与技能命中时点", reason: "当前根只有mCastTime=0.25秒等施放字段，未证明命中事件发生时点。" },
], "Q把基础伤害、自身已损生命治疗和三层控制数值分开；跨技能P/R联动与事件顺序待接。");

put("tahmkench_w", [
  levels("base_damage", "深渊潜航基础魔法伤害", "INTEGER", skillValues("tahmkench_w", "BaseDamage", 5), "客户端BaseDamage取技能等级索引1至5的100/135/170/205/240。", 10),
  fixed("ability_power_ratio", "深渊潜航法强比例", "DECIMAL", clean(calc("tahmkench_w", "TotalDamage").mFormulaParts[1].mCoefficient), "当前TotalDamage=BaseDamage+1.5×来源总法强。", 20),
  fixed("knockup_duration_ms", "深渊潜航击飞时间（毫秒）", "INTEGER", ms(at("tahmkench_w", "KnockUpDuration")), "客户端KnockUpDuration=1秒；转换为1000毫秒。", 30),
  fixed("channel_time_ms", "深渊潜航引导时间（毫秒）", "INTEGER", ms(at("tahmkench_w", "ChannelTime")), "当前ChannelTime=1.35秒；转换为1350毫秒，和其他阶段时间分开保存。", 40),
  fixed("aoe_delay_from_channel_start_ms", "深渊潜航区域伤害延迟（毫秒）", "INTEGER", ms(at("tahmkench_w", "AoEDelayFromChannelStart")), "当前AoEDelayFromChannelStart=1.5秒；转换为1500毫秒。", 50),
  fixed("total_time_ms", "深渊潜航总时间（毫秒）", "INTEGER", ms(at("tahmkench_w", "TotalTime")), "当前TotalTime=2秒；转换为2000毫秒，不与引导时间或区域延迟合并。", 60),
  levels("champion_refund_ratio", "命中英雄返还冷却与法力比例", "DECIMAL", skillValues("tahmkench_w", "ChampRefund", 5), "当前正文消费ChampRefund，取索引1至5的0.40/0.425/0.45/0.475/0.50；不把索引0的0.375当技能一级。", 70),
], [
  formula("magic_damage", "深渊潜航区域魔法伤害", add(P("base_damage"), mul(P("ability_power_ratio"), AP())), "当前TotalDamage=BaseDamage+1.5×来源总法强；命中英雄的返还比例是独立参数。", 10),
], [], [
  { item: "进入隧道的预警纯视野", reason: "EnemyWarningDelayFromChannelStart只影响敌方可见时点，属于纯视野，不录。" },
  { item: "被吞噬友方同行", reason: "友方同行是第三友方分支，本轮排除。" },
], [
  { item: "引导、伤害、返还和击飞时序", reason: "各时间参数分别保存；返还事件要求命中至少一名英雄，当前不自动创建周期或返还结果。" },
], "W保留单一敌人伤害、控制时间、引导阶段和消费当前索引1起的英雄返还比例；不把纯视野写成战斗效果。");

put("tahmkench_e", [
  fixed("shield_duration_ms", "厚实表皮主动护盾持续时间（毫秒）", "INTEGER", ms(at("tahmkench_e", "ShieldDuration")), "客户端ShieldDuration=2.5秒；转换为2500毫秒。", 10),
  fixed("out_of_combat_timer_ms", "厚实表皮脱离受伤等待时间（毫秒）", "INTEGER", ms(at("tahmkench_e", "OOCTimer")), "客户端OOCTimer=4秒；转换为4000毫秒。", 20),
  levels("grey_health_conversion_ratio", "受伤灰色生命转换比例", "DECIMAL", skillValues("tahmkench_e", "GreyHealthRatio", 5), "当前正文消费GreyHealthRatio，取索引1至5的0.15/0.23/0.31/0.39/0.47；增强双敌人分支另行排除。", 30),
  runtime("grey_health_healing_ratio", "脱离受伤灰色生命治疗比例", "DECIMAL", "当前GreyHealthHealingRatio为角色等级0.6至1的插值，实际角色等级值由运行输入提供，不把端点连成线性表。", 40),
  runtime("current_grey_health", "当前灰色生命值", "DECIMAL", "主动护盾和脱战治疗均读取当前实际灰色生命值；运行输入无默认，范围不能超过最终灰色生命上限。", 50),
  fixed("grey_health_max_hp_ratio", "灰色生命上限最大生命倍率", "DECIMAL", clean(calc("tahmkench_e", "GreyHealthMaximum").mFormulaParts[0].mCoefficient), "当前GreyHealthMaximum=3×来源最大生命；不使用未消费MaxHPHealRatio=0.1。", 60),
], [
  formula("grey_health_maximum", "灰色生命值上限", mul(P("grey_health_max_hp_ratio"), SOURCE_HP_TOTAL()), "当前GreyHealthMaximum树直接为3×来源最大生命。", 10),
  formula("grey_health_heal_value", "脱战灰色生命治疗值", mul(P("current_grey_health"), P("grey_health_healing_ratio")), "当前正文为脱离受伤后消费当前灰色生命×实际角色等级治疗比例；不把历史受伤总量再次乘转换比例。", 20),
], [
  shieldEffect("grey_health_shield", "厚实表皮自身灰色生命护盾", { kind: "PARAMETER", parameterKey: "current_grey_health" }, timedLifecycle("shield_duration_ms"), "当前主动分支把当前全部灰色生命值转为自身护盾，持续2.5秒；施放事件待接。", 30),
], [
  { item: "至少两名敌方英雄的增强灰血比例", reason: "GreyHealthRatioEnhanced及EnhancedThreshold属于多敌人增强分支，本轮唯一敌人不录。" },
  { item: "MaxHPHealRatio", reason: "当前GreyHealthHealingRatio实际消费治疗比例，MaxHPHealRatio未进入当前计算树，不建立旧字段。" },
], [
  { item: "受伤到灰血的即时转换事件", reason: "保留转换比例，但伤害输入、当前存量和封顶过程由运行事件接线。" },
  { item: "脱战治疗和护盾施放时点", reason: "数值和生命周期明确，触发、移除和治疗结算时点待接。" },
], "E把受伤转换、灰血上限、脱战治疗和主动护盾分开；护盾直接引用当前灰血参数，不重复转换。");

put("tahmkench_r", [
  levels("cooldown_ms", "大快朵颐基础冷却时间（毫秒）", "INTEGER", skillValues("tahmkench_r", "DataCooldown", 3, (value) => ms(value)), "当前CDCalc消费DataCooldown，取技能等级索引1至3的120/100/80秒；官方包装层cooldown为0不代表无冷却。", 10),
  fixed("mana_cost", "大快朵颐法力消耗", "INTEGER", at("tahmkench_r", "DataManaCost"), "当前keyCost直接消费DataManaCost=100；虽然包装层标有mDoesNotConsumeMana，仍按当前消费树保存基础法力值，不自动扣费。", 20),
  levels("base_damage", "大快朵颐敌方基础魔法伤害", "INTEGER", skillValues("tahmkench_r", "BaseDamage", 3), "客户端BaseDamage取技能等级索引1至3的100/250/400；友方BaseShield分支排除。", 30),
  fixed("target_max_hp_base_ratio", "大快朵颐目标最大生命基础比例", "DECIMAL", at("tahmkench_r", "BasePercentHPDamage"), "当前PercentHPDamage树基础项为0.15×目标最大生命。", 40),
  fixed("target_max_hp_ability_power_ratio", "大快朵颐目标最大生命法强比例", "DECIMAL", clean(calc("tahmkench_r", "PercentHPDamage").mFormulaParts[1].mCoefficient), "当前PercentHPDamage第二项为0.0007×来源总法强，结果仍是目标最大生命比例。", 50),
  fixed("enemy_devour_duration_ms", "敌方英雄吞噬最长时间（毫秒）", "INTEGER", ms(at("tahmkench_r", "EnemyDuration")), "客户端EnemyDuration=3秒；转换为3000毫秒。", 60),
  fixed("required_stack_count", "敌方吞噬所需培养品味层数", "INTEGER", 3, "当前正文明确敌方英雄需要3层培养品味。", 70),
  fixed("self_slow_ratio", "敌方吞噬期间自身减速比例", "DECIMAL", at("tahmkench_r", "SlowAmount"), "当前正文显示SlowAmount×100%，保留0.4比例；缚地是独立状态条件。", 80),
  runtime("actual_cooldown_multiplier", "大快朵颐实际冷却倍率", "DECIMAL", "当前CDCalc消费CooldownMultiplierCalculationPart；实际倍率由运行输入提供，不把包装层0数组当作冷却值。", 90),
], [
  formula("target_max_hp_damage_ratio", "大快朵颐目标最大生命伤害比例", add(P("target_max_hp_base_ratio"), mul(P("target_max_hp_ability_power_ratio"), AP())), "当前PercentHPDamage=0.15+0.0007×来源总法强，结果乘目标最大生命。", 10),
  formula("enemy_magic_damage", "大快朵颐敌方英雄魔法伤害", add(P("base_damage"), mul(add(P("target_max_hp_base_ratio"), mul(P("target_max_hp_ability_power_ratio"), AP())), TARGET_HP_TOTAL())), "当前敌方吐出伤害=BaseDamage+(0.15+0.0007×来源总法强)×目标最大生命。", 20),
  formula("actual_cooldown_ms", "大快朵颐实际冷却时间（毫秒）", mul(P("cooldown_ms"), P("actual_cooldown_multiplier")), "当前CDCalc=DataCooldown×实际冷却倍率；基础DataCooldown按技能等级保存，倍率无默认。", 30),
], [], [
  { item: "友方英雄吞噬护盾与自身移速", reason: "友方吞噬依赖另一名友方英雄，属于第三友方收益，本轮排除。" },
  { item: "友方BaseShield、AllyDuration和AllySpeedAmount", reason: "当前树和正文的友方分支不进入单一敌人范围。" },
], [
  { item: "敌方三层资格与吞噬时序", reason: "保留所需层数和3秒窗口；层数消费、缚地和吐出事件待接。" },
  { item: "基础法力实际扣除", reason: "保存当前DataManaCost=100，但mDoesNotConsumeMana与事件层语义冲突，不能自动创建扣费结果。" },
], "R修正包装层零冷却误读，沿当前CDCalc消费DataCooldown和DataManaCost；敌方伤害与实际冷却分别成式。");

const skills = {};
for (const skillKey of order) {
  const { hero, skill } = bound(skillKey);
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
if (inputIntegrity.some((item) => item.declaredMatch === false)) {
  throw new Error("输入包完整性失败: " + JSON.stringify(inputIntegrity.filter((item) => item.declaredMatch === false)));
}

const protectedSubjects = order.map((skillKey) => ({
  skillKey,
  subject: snapshot.summary?.[skillKey]?.subject || null,
  source: "输入包/参考资料/当前20槽保护快照.json",
}));
const currentCompositionLists = Object.fromEntries(order.map((skillKey) => [
  skillKey,
  snapshot.summary?.[skillKey]?.components || null,
]));
const protectedObjects = {
  subjects: protectedSubjects,
  currentCompositionLists,
  reusedPublicParameters: reuse,
  protectedReferenceRequests: snapshot.requests || [],
  protectedReferenceRoutes: [...new Set((snapshot.requests || []).map((request) => request.route))],
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
  scope: "只保护既有20个技能主体、六类组成、28项公共参数、四个角色、角色关系、代表图和四类字典；本批不更新既有对象。",
  snapshotFile: "输入包/参考资料/当前20槽保护快照.json",
  snapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
};

const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const routeByKind = {
  parameters: "parameters",
  formulas: "formulas",
  effects: "effects",
  processes: "processes",
  internalStates: "internal-states",
  triggerRules: "trigger-rules",
};
const keyByKind = {
  parameters: "parameterKey",
  formulas: "formulaKey",
  effects: "effectKey",
  processes: "processKey",
  internalStates: "stateKey",
  triggerRules: "ruleKey",
};
const allWrites = order.flatMap((skillKey) => kinds.flatMap((kind) =>
  (writes[skillKey][kind] || []).map((body) => ({ skillKey, kind, body }))
));
const requestCounts = Object.fromEntries(kinds.map((kind) => [
  kind,
  allWrites.filter((item) => item.kind === kind).length,
]));
const newTotal = Object.values(requestCounts).reduce((sum, count) => sum + count, 0);
const reusedPublicParameters = reuse.map((item) => ({
  ...item,
  source: "输入包/参考资料/公共参数复用清单.json",
  post: false,
}));
const meta = {
  generatedAt: new Date().toISOString(),
  batch: BATCH,
  status: "候选已生成，等待主负责人审查；未调用业务接口",
  gameId: "lol",
  apiBase: API_BASE,
  sourceVersion,
  scope: "布隆、芮尔、塔里克、塔姆20个技能槽；只新增来源明确参数、当前计算树的实际二元公式，以及芮尔轰落自身护盾和塔姆灰色生命自身护盾。既有20个主体、120项六类组成、28项公共参数、角色关系、图片和字典全部保护；不创建自动触发、伤害结果、直接治疗、周期过程或友方分支。",
  sourcePolicy: "固定客户端16.17、官方16.17.1和构建16.17.8104348；沿当前根绑定正文和当前计算树。未知角色等级曲线、属性阶段、目标资格、施法时序和运行输入不猜、不设默认；百分数点与比例按正文和计算树分别保存。",
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
    frozenInput: "输入包由主负责人冻结并按字节复制；源值来自根绑定当前正文和客户端计算树。",
    publicParameterReuse: "复用清单只表示既有对象保护，不复制到新增请求体；塔里克Q的cast_interval_ms为既有3秒施放间隔。",
    tahmkenchRCorrection: "塔姆R新增当前消费DataCooldown的技能等级冷却和DataManaCost=100；包装层cooldown为0且mDoesNotConsumeMana不被解释为无冷却或自动扣费。",
    noBusinessWrites: true,
  },
  protectedObjects,
  revision: "hero35-source-v1",
};
writeJson("完整候选.json", candidate);
const candidateFileSha256 = sha(fs.readFileSync(path.join(ROOT, "完整候选.json")));
// candidateFileSha256只作为外部冻结前的实际文件摘要；不回写候选，避免文件自引用。

const requests = allWrites.map((item, index) => {
  const stableKey = item.body[keyByKind[item.kind]];
  return {
    sequence: index + 1,
    method: "POST",
    route: "/skills/" + item.skillKey + "/" + routeByKind[item.kind],
    detailRoute: "/skills/" + item.skillKey + "/" + routeByKind[item.kind] + "/" + stableKey,
    skillKey: item.skillKey,
    kind: item.kind,
    stableKey,
    status: "仅意图，未调用",
    body: item.body,
  };
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
  skills: Object.fromEntries(order.map((skillKey) => {
    const source = sourceFor(skillKey);
    return [skillKey, {
      source,
      intendedValues: writes[skillKey].parameters.map((item) => ({
        parameterKey: item.parameterKey,
        name: item.name,
        valueType: item.valueType,
        valueMode: item.valueMode,
        fixedValue: item.fixedValue,
        levelValues: item.levelValues,
      })),
      formulaSources: writes[skillKey].formulas.map((item) => ({
        formulaKey: item.formulaKey,
        expression: item.expression,
        sourceCalculationNames: formulaSourceNames[skillKey]?.[item.formulaKey] || [],
      })),
      excluded: excluded[skillKey],
      pending: pending[skillKey],
    }];
  })),
};
writeJson("源值解析.json", sourceValues);
writeJson("来源哈希汇总.json", {
  generatedAt: new Date().toISOString(),
  batch: BATCH,
  sourceVersion,
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  inputFiles: sourceManifest,
  inputIntegrity,
  currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
  candidateFileSha256,
  planFileSha256,
});
writeJson("来源与范围.json", {
  batch: BATCH,
  status: "候选阶段，未调用业务接口",
  sourceVersion,
  included: [
    "布隆：P角色等级完整触发伤害和冷却/晕眩断点、Q/R单一敌人伤害、W自身双抗、E举盾数值。",
    "芮尔：P偷取和普攻伤害、Q/R单一敌人伤害、W两形态数值和自身护盾、E自身移动速度与下一次命中、R持续伤害。",
    "塔里克：P强化攻击与冷却缩短、Q充能治疗、W自身护甲和护盾数值、E单一敌人伤害、R自身免疫时间。",
    "塔姆：P额外生命/AP伤害、Q自身治疗和单一敌人伤害、W单一敌人伤害与阶段时间、E灰血和自身护盾、R敌方吞噬伤害与当前冷却/法力基础值。",
  ],
  excludedOrPending: [
    "第三友军、额外敌人、兵野专用伤害/护盾、纯视野、纯空间几何、独立召唤、友方吞噬和形态事件。",
    "未知等级插值、断点求值循环、目标资格、属性阶段、施法冲突、资源扣除与自动触发保持待接。",
  ],
  perSkillExcluded: excluded,
  perSkillPending: pending,
});
writeJson("候选版本.json", {
  batch: BATCH,
  revision: candidate.revision,
  generatedAt: new Date().toISOString(),
  status: "candidate",
  candidateFileSha256,
  planFileSha256,
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
  counts: candidate.counts,
  requestCounts,
  apiWrites: 0,
});
writeJson("冻结候选锁.json", {
  batch: BATCH,
  revision: candidate.revision,
  status: "候选已冻结，等待主负责人审查；未调用业务接口",
  candidateFileSha256,
  planFileSha256,
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  currentSnapshotSha256: fileSha("参考资料/当前20槽保护快照.json"),
  requestCount: requests.length,
  requestCounts,
  protectedCounts: protectedObjects.protectedReferenceCounts,
  apiWrites: 0,
  noApiCalls: true,
  lockType: "静态哈希锁；不代表业务数据库已写入",
});
writeJson("候选交付索引.json", {
  batch: BATCH,
  revision: candidate.revision,
  status: "候选交付，未录入业务数据",
  files: [
    "完整候选.json",
    "写前请求计划.json",
    "源值解析.json",
    "来源哈希汇总.json",
    "来源与范围.json",
    "候选版本.json",
    "冻结候选锁.json",
    "体验报告.md",
    "独立源值数学.mjs",
  ],
  candidateFileSha256,
  planFileSha256,
  counts: candidate.counts,
  requestCount: requests.length,
  apiWrites: 0,
  protectedCounts: protectedObjects.protectedReferenceCounts,
});
writeText("README.md", [
  "# 第三十五批候选",
  "",
  "本目录保存布隆、芮尔、塔里克、塔姆20个技能槽的静态候选和冻结输入副本。",
  "",
  "当前状态：候选阶段，未调用业务接口，业务写入数为0。源版本固定为客户端16.17、官方资料16.17.1、构建16.17.8104348。",
  "",
  "候选只新增来源明确参数、当前计算树实际二元公式，以及芮尔轰落自身护盾、塔姆灰色生命自身护盾。已有技能主体、六类组成、28项公共参数、角色关系、图片和字典由输入快照完整保护。未知等级曲线、属性阶段、目标资格、施法冲突和运行输入留在待核或排除说明。",
  "",
  "塔里克Q的cast_interval_ms=3000是已有公共施放间隔，只复用不新增。塔姆R按当前CDCalc/DataManaCost新增120000/100000/80000毫秒冷却和100法力基础值；包装层0冷却不作为依据。",
  "",
  "请先阅读完整候选、写前请求计划和独立源值数学报告；本批文件不构成真实数据库或页面验收证据。",
  "",
].join("\n"));
writeText("体验报告.md", [
  "# 第三十五批体验与缺口",
  "",
  "候选阶段未写入业务数据，体验记录只描述后续页面接入时需要核对的用户行为。",
  "",
  "- 布隆：Q/R伤害和W双抗应显示单位，E首个弹体归零与后续减伤应分开展示；R距离到击飞时长的映射仍待补。",
  "- 芮尔：W骑乘/披甲两分支应能分别查看，护盾应显示“持续至再次上马”；E下一次普攻或Q只能消费一次，R持续伤害不应凭界面拆成未知跳数。",
  "- 塔里克：Q应区分每层、满层和实际充能治疗；W护甲应读取施加前属性；R免疫时间不应显示为护盾值。",
  "- 塔姆：P的额外生命和法强双比例应可复核，E灰血上限、脱战治疗和当前灰血护盾应分开；R应显示当前消费的技能等级冷却，不能被包装层零值误导。",
  "",
  "待补输入：目标资格、友方/兵野边界的事件接线、等级断点实际求值、属性阶段、施法字段冲突和资源扣除时点。独立数学脚本会检查实际候选表达式的双场景、缺输入、整数毫秒、比例非负和边界拒绝。",
  "",
].join("\n"));
const outputFiles = [
  "完整候选.json",
  "写前请求计划.json",
  "源值解析.json",
  "来源哈希汇总.json",
  "来源与范围.json",
  "候选版本.json",
  "冻结候选锁.json",
  "候选交付索引.json",
  "README.md",
  "体验报告.md",
];
const fileManifest = outputFiles.map((file) => ({
  path: file,
  sha256: sha(fs.readFileSync(path.join(ROOT, file))),
  byteSize: fs.statSync(path.join(ROOT, file)).size,
}));
writeJson("文件散列.json", {
  generatedAt: new Date().toISOString(),
  batch: BATCH,
  status: "候选静态文件冻结；未调用业务接口",
  files: fileManifest,
  candidateFileSha256,
  planFileSha256,
  apiWrites: 0,
  noApiCalls: true,
});
console.log(JSON.stringify({
  candidateFileSha256,
  planFileSha256,
  requestCount: requests.length,
  requestCounts,
  counts: candidate.counts,
  protectedCounts: protectedObjects.protectedReferenceCounts,
}, null, 2));
