import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero43-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十三批");
const CURSOR = path.resolve(".agents/artifacts/hero43-cursor-review-run-20260910");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "英雄机制第四十三批";
const REVISION = "hero43-luna-candidate-v1";

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const writeNew = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
};
const writeJsonNew = (file, value) => writeNew(file, jsonBytes(value));
const round = (value, digits = 9) => Number(Number(value).toFixed(digits));
const asPercentRatio = value => round(Number(value) / 100);
const toMs = seconds => {
  const value = Math.round(Number(seconds) * 1000);
  if (!Number.isFinite(value) || value < 0 || Math.abs(value - Number(seconds) * 1000) > 1e-6) {
    throw new Error(`时间不是非负整数毫秒：${seconds}`);
  }
  return value;
};

const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const versionFile = path.join(INPUT, "输入版本.json");
const rangeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const auditFile = path.join(INPUT, "主负责人源值核对说明.md");
const inputReadmeFile = path.join(INPUT, "README.md");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const cursorConclusionFile = path.join(CURSOR, "Cursor来源复核结论.md");
const cursorAuditFile = path.join(CURSOR, "主负责人执行审计.json");
const mathScriptFile = path.join(ROOT, "独立数学核算.mjs");

const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const subjectByRoute = new Map(
  protection.requests.filter(item => /^\/skills\/[^/]+$/.test(item.route)).map(item => [item.route, item.data]),
);
const protectedRouteHashes = protection.requests.map(item => ({
  route: item.route,
  status: item.status,
  dataSha256: sha256(JSON.stringify(item.data)),
}));
const reuseSet = new Set(reuseList.map(item => `${item.skillKey}/${item.parameterKey}`));

const skillAt = (heroId, slot) => {
  const skill = sourceSkills[heroId]?.[slot];
  if (!skill) throw new Error(`缺少源技能 ${heroId}/${slot}`);
  return skill;
};
const spell = (heroId, slot) => skillAt(heroId, slot).object.mSpell;
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot).DataValues || []).find(item => item.name === name);
  if (!row || !Array.isArray(row.values)) throw new Error(`缺少DataValue ${heroId}/${slot}/${name}`);
  return row.values;
};
const dataAt = (heroId, slot, name, index = 1) => dataRow(heroId, slot, name)[index];
const levels = (heroId, slot, name, count, start = 1, transform = value => value) => Object.fromEntries(
  Array.from({ length: count }, (_, index) => [String(index + 1), transform(dataAt(heroId, slot, name, start + index))]),
);
const calculation = (heroId, slot, name) => {
  const value = (spell(heroId, slot).mSpellCalculations || {})[name];
  if (!value) throw new Error(`缺少计算树 ${heroId}/${slot}/${name}`);
  return value;
};
const coefficient = (heroId, slot, name, index = 1) => {
  const part = calculation(heroId, slot, name).mFormulaParts?.[index];
  if (!part || typeof part.mCoefficient !== "number") throw new Error(`缺少系数 ${heroId}/${slot}/${name}/${index}`);
  return round(part.mCoefficient);
};
const officialFor = (heroId, slot, english = false) => {
  const file = path.join(INPUT, "参考资料", english ? "官方英文" : "官方中文", `${heroId}.json`);
  const root = readJson(file).data[heroId];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};

const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);
const totalAD = () => A("SOURCE", "attack_damage", "TOTAL");
const bonusAD = () => A("SOURCE", "attack_damage", "BONUS");
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const targetHP = () => A("TARGET", "hp", "TOTAL");

const fixed = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "FIXED", fixedValue, levelValues: null, description, sortOrder,
});
const skill = (parameterKey, name, valueType, levelValues, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "SKILL_LEVEL", fixedValue: null, levelValues, description, sortOrder,
});
const character = (parameterKey, name, valueType, levelValues, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "CHARACTER_LEVEL", fixedValue: null, levelValues, description, sortOrder,
});
const runtime = (parameterKey, name, valueType, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "RUNTIME_INPUT", fixedValue: null, levelValues: null, description, sortOrder,
});
const formula = (formulaKey, name, expression, description, sortOrder) => ({
  formulaKey, name, expression, description, sortOrder,
});

const lifecycle = (durationValue = null, instanceScope = "SOURCE") => ({
  durationValue,
  maxStacksValue: { kind: "FIXED", value: 1 },
  applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope,
  reapplicationStackMode: "KEEP",
  reapplicationDurationMode: durationValue ? "REFRESH_ALL" : null,
  expiryMode: durationValue ? "ALL_AT_ONCE" : "EXPLICIT_ONLY",
  periodicIntervalValue: null,
  firstPeriodicExecution: null,
});
const persistentResultLifecycle = (reapplicationValueMode = "REPLACE") => ({
  moment: "PERSISTENT",
  valueReadMode: "APPLICATION_SNAPSHOT",
  stackValueMode: "SHARED",
  reapplicationValueMode,
  periodicExecutionMode: null,
});
const valueRule = (kind, key) => ({
  value: { kind, [kind === "PARAMETER" ? "parameterKey" : "formulaKey"]: key },
  fixedMultiplier: 1,
  fixedMinValue: 0,
  fixedMaxValue: null,
});
const resourceEffect = (skillKey, attributeKey, parameterKey, order = 900) => ({
  effectKey: `${attributeKey}_cost`,
  name: attributeKey === "mana" ? "施放法力消耗" : "施放能量消耗",
  description: "仅记录基础资源消耗；实际扣除时点与施放资格由事件层接线。",
  sortOrder: order,
  lifecycle: null,
  results: [{
    resultKey: "consume_resource",
    name: attributeKey === "mana" ? "消耗法力" : "消耗能量",
    resultType: "RESOURCE_CHANGE",
    target: "SOURCE",
    description: "不表示战斗事件已经接线。",
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: valueRule("PARAMETER", parameterKey),
    detail: { attributeKey, operation: "CONSUME" },
  }],
});
const attributeEffect = (effectKey, name, attributeKey, valueKind, valueKey, durationKey, order = 20, description = "只定义自身属性变化；触发事件由事件层接线。") => ({
  effectKey,
  name,
  description,
  sortOrder: order,
  lifecycle: lifecycle(durationKey ? { kind: "PARAMETER", parameterKey: durationKey } : null),
  results: [{
    resultKey: "attribute",
    name,
    resultType: "ATTRIBUTE_CHANGE",
    target: "SOURCE",
    description,
    sortOrder: 10,
    lifecycleBehavior: persistentResultLifecycle(),
    spellShieldBlockScope: null,
    valueRule: valueRule(valueKind, valueKey),
    detail: { attributeKey, operation: "INCREASE", modifierZoneKey: "attribute_flat_add" },
  }],
});
const shieldEffect = (effectKey, name, formulaKey, durationKey, order = 20) => ({
  effectKey,
  name,
  description: "只定义自身普通护盾数值与生命周期；触发事件由事件层接线。",
  sortOrder: order,
  lifecycle: lifecycle({ kind: "PARAMETER", parameterKey: durationKey }),
  results: [{
    resultKey: "shield",
    name,
    resultType: "NORMAL_SHIELD",
    target: "SOURCE",
    description: "普通护盾，触发和移除事件由事件层接线。",
    sortOrder: 10,
    lifecycleBehavior: persistentResultLifecycle(),
    spellShieldBlockScope: null,
    valueRule: valueRule("FORMULA", formulaKey),
    detail: { absorbedDamageTypeKey: null, decayMode: "NONE" },
  }],
});
const cooldownEffect = (effectKey, name, parameterKey, affectedSkillKeys, order = 30) => ({
  effectKey,
  name,
  description: "仅记录来源明确的指定技能冷却缩短；命中资格和实际扣减时点由事件层接线。",
  sortOrder: order,
  lifecycle: null,
  results: [{
    resultKey: "reduce_cooldown",
    name,
    resultType: "COOLDOWN_CHANGE",
    target: "SOURCE",
    description: "只影响指定技能。",
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: valueRule("PARAMETER", parameterKey),
    detail: {
      affectedSkillScope: { mode: "SKILLS", skillKeys: affectedSkillKeys, skillCategoryKeys: [] },
      operation: "REDUCE",
    },
  }],
});

const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const bindingSkill = skillAt(heroId, slot);
  const rawSpell = bindingSkill.object.mSpell;
  const raw = {
    dataValues: Object.fromEntries((rawSpell.DataValues || []).map(row => [row.name, row.values ? row.values.slice() : null])),
    calculations: clone(rawSpell.mSpellCalculations || {}),
    fields: Object.fromEntries([
      "spellCastTime", "mCastTime", "spellTotalTime", "mChannelDuration", "cooldownTime", "mana", "manaValues",
      "mMaxAmmo", "mAmmoRechargeTime", "mDoesNotConsumeMana", "mDoesNotConsumeCooldown", "mTargetingTypeData", "mClientData",
    ].map(key => [key, rawSpell[key] ?? null])),
  };
  const sourceSkillMeta = hero.source.skills.find(item => item.slot === slot);
  return {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    slot,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath,
    spellPath: sourceSkillMeta.clientPath,
    bindingAvailable: sourceSkillMeta.bindingAvailable,
    clientFile: `参考资料/客户端原文/${heroId}.json.gz`,
    clientSha256: hero.source.client.sha256,
    clientCompressedSha256: shaFile(path.join(INPUT, "参考资料", "客户端原文", `${heroId}.json.gz`)),
    clientBuild: hero.source.client.contentVersion,
    officialZhFile: `参考资料/官方中文/${heroId}.json`,
    officialZhSha256: shaFile(path.join(INPUT, "参考资料", "官方中文", `${heroId}.json`)),
    officialEnFile: `参考资料/官方英文/${heroId}.json`,
    officialEnSha256: shaFile(path.join(INPUT, "参考资料", "官方英文", `${heroId}.json`)),
    currentBoundText: clone(bindingSkill.currentTexts),
    raw,
    officialEvidence: { zh: clone(officialFor(heroId, slot)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}/currentTexts`,
  };
};

const defs = {};
const define = (heroId, slot, displayName, maxLevel, build, excluded = [], pending = [], proofNote = "") => {
  const write = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  const addParameter = item => write.parameters.push(item);
  const addFormula = item => write.formulas.push(item);
  const addEffect = item => write.effects.push(item);
  build(addParameter, addFormula, addEffect);
  const skillKey = `${heroId.toLowerCase()}_${slot.toLowerCase()}`;
  for (const parameter of write.parameters) {
    if (reuseSet.has(`${skillKey}/${parameter.parameterKey}`)) throw new Error(`新参数重复公共参数 ${skillKey}/${parameter.parameterKey}`);
  }
  defs[skillKey] = {
    skillKey,
    name: `${heroes[heroId].name}·${displayName}`,
    maxLevel,
    source: sourceFor(heroId, slot),
    write,
    protectedExisting: {
      subject: subjectByRoute.has(`/skills/${skillKey}`),
      compositionLists: true,
      protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json",
    },
    excluded,
    pending,
    proofs: [
      { type: "root-bound-source", path: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}` },
      { type: "fixed-source-version", client: binding.clientVersion, official: binding.officialVersion, build: heroes[heroId].source.client.contentVersion },
    ],
    proofNote,
    currentSubject: clone(subjectByRoute.get(`/skills/${skillKey}`) || null),
  };
};

// 普朗克
define("Gangplank", "P", "烈火审讯", 1, (add, addFormula, addEffect) => {
  add(fixed("cooldown_ms", "被动冷却时间（毫秒）", "INTEGER", 15000, "客户端DataValues.Cooldown=15秒，转换为整数毫秒。", 10));
  add(runtime("actual_damage_base", "当前角色等级被动基础真实伤害", "DECIMAL", "客户端TotalDamage为角色等级50至250的插值；中间等级算法未证，运行层提供当前实际基础项，不设默认。", 20));
  add(fixed("damage_base_lower", "被动基础真实伤害下界", "INTEGER", 50, "TotalDamage角色等级插值下界。", 30));
  add(fixed("damage_base_upper", "被动基础真实伤害上界", "INTEGER", 250, "TotalDamage角色等级插值上界。", 40));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", dataAt("Gangplank", "P", "ADRatio"), "TotalDamage使用来源额外攻击力，倍率为1。", 50));
  add(fixed("damage_duration_ms", "全程真实伤害持续（毫秒）", "INTEGER", toMs(dataAt("Gangplank", "P", "DoTDuration")), "正文明确2.5秒全程值；不当作每跳伤害。", 60));
  add(runtime("actual_move_speed_ratio", "当前角色等级被动移动速度比例", "DECIMAL", "客户端MoveSpeed为15%至30%的角色等级插值；中间等级算法未证，运行层提供当前比例，不设默认。", 70));
  add(fixed("move_speed_lower_ratio", "被动移动速度比例下界", "DECIMAL", round(calculation("Gangplank", "P", "MoveSpeed").mFormulaParts[0].mStartValue), "MoveSpeed角色等级插值下界，比例属性以1表示100%。", 80));
  add(fixed("move_speed_upper_ratio", "被动移动速度比例上界", "DECIMAL", round(calculation("Gangplank", "P", "MoveSpeed").mFormulaParts[0].mEndValue), "MoveSpeed角色等级插值上界，比例属性以1表示100%。", 90));
  add(fixed("move_speed_duration_ms", "被动移动速度持续（毫秒）", "INTEGER", toMs(dataAt("Gangplank", "P", "MoveSpeedDuration")), "正文明确2秒。", 100));
  addFormula(formula("passive_true_damage", "烈火审讯全程真实伤害", ADD(P("actual_damage_base"), MUL(P("bonus_ad_ratio"), bonusAD())), "TotalDamage=当前角色等级基础项+1.0×来源额外攻击力；这是2.5秒全程值。", 10));
  addEffect(attributeEffect("self_move_speed", "烈火审讯自身移动速度", "move_speed_percent", "PARAMETER", "actual_move_speed_ratio", "move_speed_duration_ms", 20, "只定义自身移动速度比例；角色等级插值和刷新条件待接线。"));
}, [
  { item: "火药桶摧毁刷新被动冷却", reason: "跨技能资格明确但本轮火药桶陷阱系统跳过，不宣称刷新已接。" },
  { item: "防御塔伤害倍率", reason: "目标类型为建筑物，非唯一敌方英雄范围。" },
], [
  { item: "角色等级基础伤害和移动速度插值", reason: "仅有起止值，没有可靠中间算法；改用无默认实际输入。" },
  { item: "被动触发和每目标时序", reason: "当前候选只保留数值与生命周期。" },
], "保留自身被动真实伤害与自身移速；不把全程总值拆成未经来源支持的每跳值。独立数学报告对基础项与加成项各给两场景。 ");

define("Gangplank", "Q", "枪火谈判", 5, (add, addFormula, addEffect) => {
  add(skill("base_damage", "枪火谈判基础物理伤害", "INTEGER", levels("Gangplank", "Q", "SpellDamage", 5), "当前模式1正文展开为DataValues.SpellDamage索引1至5：10/40/70/100/130；索引0负值不作1级。", 10));
  add(fixed("total_ad_ratio", "总攻击力倍率", "DECIMAL", dataAt("Gangplank", "Q", "ADRatio"), "ShotDamage的mStat=2，读取来源总攻击力。", 20));
  add(fixed("current_game_mode", "当前技能文本模式", "INTEGER", dataAt("Gangplank", "Q", "GameModeInteger"), "当前绑定文本使用模式1；不引入翡翠旧模式。", 30));
  add(fixed("crit_damage_mod", "暴击伤害修正倍率", "DECIMAL", dataAt("Gangplank", "Q", "CritDamageMod"), "ShotCrit当前消费为1+CritDamageMod×(实际暴击统计−1)。", 40));
  add(runtime("critical_stat", "当前暴击伤害统计量", "DECIMAL", "ShotCrit的mStat9含义未在当前根绑定中证实，运行层提供实际值，不设默认。", 50));
  add(fixed("crit_baseline", "暴击统计基准", "DECIMAL", 1, "ShotCrit树中的固定1。", 60));
  add(fixed("minus_one", "固定减一", "INTEGER", -1, "ShotCrit树中的固定-1，用于实际统计量相对基准的差值。", 70));
  const shotDamage = ADD(P("base_damage"), MUL(P("total_ad_ratio"), totalAD()));
  const shotCritMultiplier = ADD(P("crit_baseline"), MUL(P("crit_damage_mod"), ADD(P("critical_stat"), P("minus_one"))));
  addFormula(formula("shot_physical_damage", "枪火谈判单次物理伤害", shotDamage, "ShotDamage=基础值+总攻击力。", 10));
  addFormula(formula("shot_crit_multiplier", "枪火谈判暴击倍率", shotCritMultiplier, "ShotCrit=1+CritDamageMod×(实际mStat9−1)。", 20));
  addFormula(formula("shot_crit_physical_damage", "枪火谈判暴击物理伤害", MUL(shotCritMultiplier, shotDamage), "暴击完整伤害=ShotCrit×ShotDamage；不附带烈火审讯。", 30));
  addEffect(resourceEffect("gangplank_q", "mana", "mana_cost"));
}, [
  { item: "金币和银蛇币", reason: "纯经济收益。" },
  { item: "翡翠模式返还法力", reason: "当前模式1已展开，不采用旧特殊模式文本。" },
  { item: "烈火审讯附加攻击特效", reason: "当前正文明确排除普朗克P。" },
], [
  { item: "暴击统计量mStat9", reason: "保留无默认运行输入。" },
], "保留当前模式1的唯一目标基础弹道与完整暴击倍率。 ");

define("Gangplank", "W", "坏血病疗法", 5, (add, addFormula, addEffect) => {
  add(skill("base_heal", "坏血病疗法基础治疗", "INTEGER", levels("Gangplank", "W", "BaseHeal", 5), "BaseHealth使用DataValues.BaseHeal索引1至5：45/70/95/120/145。", 10));
  add(fixed("heal_ap_ratio", "基础治疗法强倍率", "DECIMAL", coefficient("Gangplank", "W", "BaseHealth"), "BaseHealth计算树系数0.9，读取来源总法强。", 20));
  add(fixed("missing_health_heal_ratio", "已损生命治疗比例", "DECIMAL", asPercentRatio(dataAt("Gangplank", "W", "PercentHeal")), "正文为13%已损生命，换成比例0.13。", 30));
  add(runtime("actual_missing_health", "当前自身已损生命值", "DECIMAL", "正文治疗还需要施放瞬间自身已损生命值，运行层提供实际值，不设默认。", 40));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", 250, "当前根正文与客户端施法字段支持250毫秒。", 50));
  addFormula(formula("self_heal", "坏血病疗法自身治疗量", ADD(ADD(P("base_heal"), MUL(P("heal_ap_ratio"), AP())), MUL(P("missing_health_heal_ratio"), P("actual_missing_health"))), "BaseHeal+0.9×来源总法强+13%自身已损生命。", 10));
  addEffect(resourceEffect("gangplank_w", "mana", "mana_cost"));
}, [
  { item: "HasteAmount和未消费Steroid/BuffDuration", reason: "当前行为不消费旧提示字段。" },
  { item: "控制清除具体免疫资格", reason: "保留官方清除限制效果边界，不伪造绝对免疫。" },
], [{ item: "已损生命读取时点", reason: "数值式已保留，事件时点待接线。" }], "治疗公式把基础项、法强项和自身已损生命项分开。 ");

define("Gangplank", "E", "火药桶", 5, () => {}, [
  { item: "火药桶放置、血量、充能、连锁爆炸和桶内伤害", reason: "陷阱及放置物系统本轮跳过。" },
  { item: "桶爆炸刷新被动", reason: "跨技能刷新资格保留在普朗克P范围记录，本槽不制造零伤害占位。" },
], [{ item: "陷阱系统", reason: "不把桶技能清空误当作本体技能没有根绑定；完整原文仍在source中。" }], "本体槽保持六类写入数组为空，不用0占位。 ");

define("Gangplank", "R", "加农炮幕", 3, (add, addFormula, addEffect) => {
  add(skill("damage_per_wave", "加农炮幕每波魔法伤害基础值", "INTEGER", levels("Gangplank", "R", "DamagePerWave", 3), "OneWaveDamage使用DataValues.DamagePerWave索引1至3：40/70/100。", 10));
  add(fixed("ap_ratio", "每波法强倍率", "DECIMAL", coefficient("Gangplank", "R", "OneWaveDamage"), "OneWaveDamage系数0.1，读取来源总法强。", 20));
  add(fixed("total_waves", "基础炮弹波数", "INTEGER", dataAt("Gangplank", "R", "TotalWavesTooltip"), "正文明确8秒内12波。", 30));
  add(fixed("additional_waves", "随意开火额外波数", "INTEGER", 6, "升级分支明确额外6波。", 40));
  add(fixed("zone_duration_ms", "炮幕区域持续（毫秒）", "INTEGER", toMs(dataAt("Gangplank", "R", "ZoneDuration")), "正文明确8秒。", 50));
  add(fixed("slow_percent_points", "炮幕减速百分数点", "INTEGER", dataAt("Gangplank", "R", "SlowPercent"), "原始值30，当前正文以百分号显示，保存为30百分数点。", 60));
  add(fixed("slow_duration_ms", "每波减速持续（毫秒）", "INTEGER", toMs(dataAt("Gangplank", "R", "SlowDuration")), "正文明确每波0.5秒减速。", 70));
  add(skill("deaths_daughter_base_damage", "死亡之女真实伤害基础值", "INTEGER", levels("Gangplank", "R", "DeathsDaughterBaseDamage", 3), "DeathsDaughterDamage使用索引1至3：120/210/300。", 80));
  add(fixed("deaths_daughter_ap_ratio", "死亡之女法强倍率", "DECIMAL", coefficient("Gangplank", "R", "DeathsDaughterDamage"), "死亡之女计算树系数0.3，读取来源总法强。", 90));
  add(fixed("deaths_daughter_slow_percent_points", "死亡之女减速百分数点", "INTEGER", dataAt("Gangplank", "R", "DeathsDaughterSlow"), "原始值75，保存为75百分数点。", 100));
  add(fixed("deaths_daughter_slow_duration_ms", "死亡之女减速持续（毫秒）", "INTEGER", toMs(dataAt("Gangplank", "R", "DeathsDaughterSlowDuration")), "正文明确1秒。", 110));
  add(fixed("raise_morale_move_speed_ratio", "鼓舞士气自身移动速度比例", "DECIMAL", asPercentRatio(dataAt("Gangplank", "R", "RaiseMoraleHaste")), "正文40%移动速度，比例属性以0.4记录，效果使用attribute_flat_add。", 120));
  add(fixed("raise_morale_duration_ms", "鼓舞士气持续（毫秒）", "INTEGER", toMs(dataAt("Gangplank", "R", "RaiseMoraleHasteDuration")), "正文明确2秒。", 130));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", 250, "当前根施法字段支持250毫秒。", 140));
  const wave = ADD(P("damage_per_wave"), MUL(P("ap_ratio"), AP()));
  addFormula(formula("one_wave_magic_damage", "加农炮幕每波魔法伤害", wave, "OneWaveDamage=每波基础值+0.1×来源总法强。", 10));
  addFormula(formula("full_magic_damage", "加农炮幕基础全程魔法伤害", MUL(P("total_waves"), wave), "8秒12波全程值=12×每波伤害；不编每波命中时钟。", 20));
  addFormula(formula("full_magic_damage_with_extra_waves", "随意开火升级全程魔法伤害", MUL(ADD(P("total_waves"), P("additional_waves")), wave), "随意开火全程波数=12+6；只记录来源明确的战前升级分支。", 30));
  addFormula(formula("deaths_daughter_true_damage", "死亡之女真实伤害", ADD(P("deaths_daughter_base_damage"), MUL(P("deaths_daughter_ap_ratio"), AP())), "DeathsDaughterDamage=基础值+0.3×来源总法强。", 40));
  addEffect(attributeEffect("self_raise_morale_move_speed", "鼓舞士气自身移动速度", "move_speed_percent", "PARAMETER", "raise_morale_move_speed_ratio", "raise_morale_duration_ms", 30, "自身是否属于炮幕友军资格待核；若成立，增量按比例属性和attribute_flat_add处理。"));
  addEffect(resourceEffect("gangplank_r", "mana", "mana_cost", 910));
}, [
  { item: "商店购买方式、金币和银蛇币", reason: "纯经济或外部升级操作，不生成技能效果。" },
  { item: "炮幕对第三友方的普遍效果", reason: "本轮只保留自身可能收益，额外友方分配排除。" },
], [
  { item: "鼓舞士气自身资格", reason: "不能只按友军字样排除自身，先保留自身效果，资格待核。" },
  { item: "CannonDelay、CannonInterval与每波命中时钟", reason: "原始时序保留在source，不把0.5秒和2秒编成每跳时间。" },
], "基础12波、随意开火6波和死亡之女独立式分开；移速效果保留自身资格待核。 ");

// 千珏
define("Kindred", "P", "千珏之印", 1, (add, addFormula) => {
  add(runtime("mark_count", "当前战斗印记层数", "INTEGER", "战前选择和击杀所得印记属于战斗输入，不设默认。", 10));
  add(fixed("initial_mark_threshold", "首段射程奖励所需印记", "INTEGER", dataAt("Kindred", "P", "InitialMarkThreshold"), "正文优先明确4层。", 20));
  add(fixed("additional_mark_threshold", "后续射程奖励间隔印记", "INTEGER", dataAt("Kindred", "P", "AdditionalMarkThreshold"), "当前正文明确之后每3层。", 30));
  add(fixed("range_increase", "后续每层射程增加", "INTEGER", dataAt("Kindred", "P", "RangeIncrease"), "正文按每3层增加25攻击距离。", 40));
  add(fixed("first_tier_multiplier", "首段射程乘数", "INTEGER", dataAt("Kindred", "P", "FirstTierMultiplier"), "当前匿名树首段为RangeIncrease×3。", 50));
  add(runtime("additional_range_tier_count", "当前已满足的后续射程档数", "INTEGER", "后续每3层的整档数需要战斗层提供，不用除法或默认值猜测。", 60));
  add(fixed("q_attack_speed_per_mark_ratio", "Q每层额外攻击速度比例", "DECIMAL", coefficient("Kindred", "P", "QMarkBonus", 0), "QMarkBonus原始显示比例0.05。", 70));
  add(fixed("w_current_health_per_mark_ratio", "W每层当前生命伤害比例", "DECIMAL", coefficient("Kindred", "P", "WMarkBonus", 0), "WMarkBonus原始显示比例0.01；狼灵自主攻击式本轮跳过。", 80));
  add(fixed("e_missing_health_per_mark_ratio", "E每层已损生命伤害比例", "DECIMAL", coefficient("Kindred", "P", "EMarkBonus", 0), "EMarkBonus原始显示比例0.005。", 90));
  addFormula(formula("first_tier_range_increase", "千珏之印首段射程增加", MUL(P("range_increase"), P("first_tier_multiplier")), "首段匿名树=25×3；别名与触发阈值仍由战斗状态接线。", 10));
  addFormula(formula("additional_range_increase", "千珏之印后续射程增加", MUL(P("range_increase"), P("additional_range_tier_count")), "后续射程=25×已满足的3层整档数。", 20));
  addFormula(formula("q_mark_attack_speed_bonus", "千珏之印对Q的攻速加成", MUL(P("mark_count"), P("q_attack_speed_per_mark_ratio")), "Q每层印记增加0.05比例。", 30));
  addFormula(formula("w_mark_current_health_damage_ratio", "千珏之印对W的当前生命伤害加成", MUL(P("mark_count"), P("w_current_health_per_mark_ratio")), "W每层印记增加0.01比例；对应狼灵自主输出的消费由范围排除。", 40));
  addFormula(formula("e_mark_missing_health_damage_ratio", "千珏之印对E的已损生命伤害加成", MUL(P("mark_count"), P("e_missing_health_per_mark_ratio")), "E每层印记增加0.005比例。", 50));
}, [
  { item: "狩猎目标选择、野怪地图标记和纯视野", reason: "状态展示或野怪专用。" },
  { item: "狼灵自主攻击与W每层狼伤", reason: "自主召唤输出跳过，不夹入本体。" },
], [
  { item: "首段匿名树与FirstTierRangeIncreaseTT别名", reason: "首段数值25×3保留，别名和触发事件待核。" },
  { item: "印记战斗输入", reason: "层数由运行状态提供。" },
], "保留印记对Q、W、E的当前消费及两段射程式；W狼灵输出单独排除。 ");

define("Kindred", "Q", "乱箭之舞", 5, (add, addFormula, addEffect) => {
  add(skill("base_damage", "乱箭之舞单箭物理伤害", "INTEGER", levels("Kindred", "Q", "BaseDamage", 5), "TotalDamage使用DataValues.BaseDamage索引1至5：40/65/90/115/140；唯一目标只取一支箭。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", coefficient("Kindred", "Q", "TotalDamage"), "TotalDamage系数0.75，读取来源额外攻击力。", 20));
  add(fixed("base_attack_speed_ratio", "基础攻击速度比例", "DECIMAL", dataAt("Kindred", "Q", "BaseBonusAS"), "TotalQAttackSpeed基础项0.35，比例属性以1表示100%。", 30));
  add(runtime("mark_count", "当前战斗印记层数", "INTEGER", "Q攻速加成需要战斗层提供当前印记数，不设默认。", 40));
  add(fixed("attack_speed_per_mark_ratio", "每层印记攻击速度比例", "DECIMAL", coefficient("Kindred", "Q", "TotalQAttackSpeed", 1), "TotalQAttackSpeed每层0.05。", 50));
  add(fixed("attack_speed_duration_ms", "Q攻击速度持续（毫秒）", "INTEGER", toMs(dataAt("Kindred", "Q", "BaseASDuration")), "正文明确4秒。", 60));
  add(skill("w_zone_cooldown_ms", "W区域内Q冷却时间（毫秒）", "INTEGER", Object.fromEntries([4, 3.5, 3, 2.5, 2].map((value, index) => [String(index + 1), toMs(value)])), "当前正文展开为4/3.5/3/2.5/2秒；原始CDNewValue索引2至6，保留W区域资格待接。", 70));
  add(fixed("dash_speed", "翻滚基础速度", "INTEGER", dataAt("Kindred", "Q", "DashSpeed"), "当前根DashSpeed=500。", 80));
  add(fixed("dash_speed_scaling", "翻滚移速缩放参数", "INTEGER", dataAt("Kindred", "Q", "DashSpeedScaling"), "当前根DashSpeedScaling=12；算法未证，只记录原始参数。", 90));
  add(fixed("m_cast_time_ms", "客户端mCastTime（毫秒）", "INTEGER", toMs(spell("Kindred", "Q").mCastTime), "当前根mCastTime=0.01秒；与spellCastTime冲突，不能选作唯一施法时间。", 100));
  add(fixed("spell_cast_time_ms", "客户端spellCastTime（毫秒）", "INTEGER", toMs(spell("Kindred", "Q").spellCastTime), "当前根spellCastTime=0.25秒；与mCastTime并列保留。", 110));
  addFormula(formula("arrow_physical_damage", "乱箭之舞唯一目标物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "TotalDamage=基础值+0.75×来源额外攻击力；不乘最多三名目标。", 10));
  addFormula(formula("total_attack_speed_ratio", "乱箭之舞自身攻击速度比例", ADD(P("base_attack_speed_ratio"), MUL(P("mark_count"), P("attack_speed_per_mark_ratio"))), "TotalQAttackSpeed=0.35+0.05×当前印记层数。", 20));
  addEffect(attributeEffect("self_attack_speed", "乱箭之舞自身攻击速度", "bonus_attack_speed_percent", "FORMULA", "total_attack_speed_ratio", "attack_speed_duration_ms", 20, "自身攻速比例增量使用attribute_flat_add；不把0.35当成攻速点数。"));
  addEffect(resourceEffect("kindred_q", "mana", "mana_cost"));
}, [
  { item: "最多三名目标的额外箭矢", reason: "本轮唯一敌人只保留当前目标一支箭。" },
  { item: "狼灵区域内狼伤", reason: "自主召唤输出跳过。" },
], [
  { item: "W区域Q冷却资格", reason: "冷却数值和技能范围已记录，区域事件待接。" },
  { item: "DashSpeedScaling算法与两个施法时间字段冲突", reason: "不编移速曲线，不任取0.01或0.25作为唯一结论。" },
], "保留唯一目标箭伤和自身攻速效果；攻速增量按比例属性单位处理。 ");

define("Kindred", "W", "狼灵狂热", 5, (add, addFormula, addEffect) => {
  add(fixed("attack_heal_level1", "100层后自身治疗1级基值", "INTEGER", calculation("Kindred", "W", "AttackHeal").mFormulaParts[0].mLevel1Value, "AttackHeal角色等级树起点47。", 10));
  add(fixed("attack_heal_per_character_level", "每角色等级自身治疗增量", "INTEGER", calculation("Kindred", "W", "AttackHeal").mFormulaParts[0].mInitialBonusPerLevel, "AttackHeal每级初始增量2；中间等级算法按补核要求不展开为18级数组。", 20));
  add(runtime("actual_attack_heal", "当前角色等级自身最大治疗", "DECIMAL", "原树提供1级47和每级初始增量2，但补核明确不把推断的47至81直接固化；运行层提供当前实际值，不设默认。", 30));
  add(fixed("full_stack_count", "自身治疗触发层数", "INTEGER", 100, "官方中文正文明确100层。", 40));
  add(fixed("zone_duration_ms", "狼灵领地持续（毫秒）", "INTEGER", toMs(dataAt("Kindred", "W", "ZoneDuration")), "正文明确8.5秒区域。", 50));
  add(fixed("ring_range", "狼灵领地范围", "INTEGER", dataAt("Kindred", "W", "RingRange"), "当前根RingRange=800；不把范围当伤害。", 60));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Kindred", "W").spellCastTime), "当前根spellCastTime=0.25秒。", 70));
  addFormula(formula("self_attack_heal", "狼灵狂热自身最大治疗", P("actual_attack_heal"), "运行层当前实际自身最大治疗；实际已损生命折算和触发时点待接。", 10));
}, [
  { item: "狼灵自主攻击、攻速换算和野怪修正", reason: "自主召唤输出或野怪专用。" },
], [
  { item: "AttackHeal角色等级中间算法", reason: "只记录47起点和每级2增量，使用无默认实际输入。" },
  { item: "100层积攒、已损生命比例和W区域事件", reason: "数值及边界保留，状态时点待接。" },
], "不能因跳过狼灵输出而丢掉W自身治疗；治疗量以无默认运行输入承接未知角色等级算法。 ");

define("Kindred", "E", "横生惧意", 5, (add, addFormula) => {
  add(skill("base_bite_damage", "狼跃基础物理伤害", "INTEGER", levels("Kindred", "E", "BaseDamage", 5), "BaseBiteDamage使用索引1至5：80/110/140/170/200。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", dataAt("Kindred", "E", "BonusADRatio"), "BaseBiteDamage读取来源额外攻击力，倍率为1。", 20));
  add(fixed("base_missing_health_ratio", "基础已损生命伤害比例", "DECIMAL", dataAt("Kindred", "E", "BasePercentDamage"), "PercentBiteDamage基础比例0.05。", 30));
  add(runtime("mark_count", "当前战斗印记层数", "INTEGER", "E的印记强化需要战斗层提供当前印记数，不设默认。", 40));
  add(fixed("missing_health_per_mark_ratio", "每层印记已损生命伤害比例", "DECIMAL", coefficient("Kindred", "E", "PercentBiteDamage", 1), "当前消费树每层增加0.005比例。", 50));
  add(runtime("actual_target_missing_health", "当前目标已损生命值", "DECIMAL", "最终狼跃伤害需要命中时目标已损生命值，运行层提供实际值，不设默认。", 60));
  add(fixed("crit_mod", "暴击强化系数", "DECIMAL", dataAt("Kindred", "E", "CritMod"), "当前两条消费树使用0.5暴击强化系数。", 70));
  add(runtime("critical_stat8", "当前mStat8暴击相关统计量", "DECIMAL", "BaseBiteDamage与PercentBiteDamage当前消费树均读取mStat8，含义未独立证实，不设默认。", 80));
  add(runtime("critical_stat9", "当前mStat9暴击伤害统计量", "DECIMAL", "两条当前消费树均读取mStat9，运行层提供实际值，不设默认。", 90));
  add(fixed("crit_baseline", "暴击统计基准", "DECIMAL", 1, "两条消费树中的固定1。", 100));
  add(fixed("minus_one", "固定减一", "INTEGER", -1, "两条消费树中的固定-1。", 110));
  add(fixed("slow_base_percent_points", "减速基础百分数点", "INTEGER", dataAt("Kindred", "E", "SlowAmount"), "当前正文显示30%减速，保存为30百分数点。", 120));
  add(fixed("slow_ap_ratio", "减速法强倍率", "DECIMAL", dataAt("Kindred", "E", "SlowAPRatio"), "TotalSlow使用法强倍率0.05，结果单位为百分数点。", 130));
  add(fixed("slow_duration_ms", "减速持续（毫秒）", "INTEGER", toMs(dataAt("Kindred", "E", "SlowDuration")), "正文明确1秒。", 140));
  add(fixed("total_duration_ms", "第三次攻击窗口（毫秒）", "INTEGER", toMs(dataAt("Kindred", "E", "TotalDuration")), "正文明确4秒内第三次攻击触发狼跃。", 150));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Kindred", "E").spellCastTime), "当前根spellCastTime=0.25秒。", 160));
  const rawBite = ADD(P("base_bite_damage"), MUL(P("bonus_ad_ratio"), bonusAD()));
  const critDelta = MUL(P("crit_mod"), ADD(P("critical_stat9"), P("minus_one")));
  const critMultiplier = ADD(P("crit_baseline"), MUL(P("critical_stat8"), critDelta));
  const rawMissingRatio = ADD(P("base_missing_health_ratio"), MUL(P("mark_count"), P("missing_health_per_mark_ratio")));
  addFormula(formula("raw_bite_damage", "横生惧意未修正基础撕咬", rawBite, "基础撕咬=基础值+额外攻击力。", 10));
  addFormula(formula("critical_multiplier", "横生惧意暴击修正倍率", critMultiplier, "当前两条消费树共同使用1+mStat8×0.5×(mStat9−1)。", 20));
  addFormula(formula("corrected_bite_damage", "横生惧意修正基础撕咬", MUL(critMultiplier, rawBite), "基础撕咬整体乘当前消费暴击修正。", 30));
  addFormula(formula("raw_missing_health_ratio", "横生惧意未修正已损生命比例", rawMissingRatio, "已损生命比例=0.05+0.005×当前印记层数。", 40));
  addFormula(formula("corrected_missing_health_ratio", "横生惧意修正已损生命比例", MUL(critMultiplier, rawMissingRatio), "已损生命比例也整体乘同一当前消费暴击修正。", 50));
  addFormula(formula("wolf_lunge_physical_damage", "横生惧意第三次攻击狼跃物理伤害", ADD(MUL(critMultiplier, rawBite), MUL(MUL(critMultiplier, rawMissingRatio), P("actual_target_missing_health"))), "第三次攻击狼跃=修正基础撕咬+修正已损生命比例×目标已损生命。", 60));
  addFormula(formula("slow_percent_points", "横生惧意减速百分数点", ADD(P("slow_base_percent_points"), MUL(P("slow_ap_ratio"), AP())), "TotalSlow=30+0.05×来源总法强，结果保持百分数点单位。", 70));
}, [
  { item: "野怪已损生命伤害上限", reason: "野怪专用。" },
  { item: "未消费CritDamage旧树", reason: "不叠加到当前两条消费树。" },
], [
  { item: "mStat8、mStat9及第三次攻击事件", reason: "两条修正树和窗口已保留，暴击统计与命中事件待接。" },
], "保留千珏E第三次攻击的狼跃载体、两条当前消费树的共同暴击修正和减速；不把StacksToProc=4替代正文第三次攻击。 ");

define("Kindred", "R", "羊灵生息", 3, (add, addFormula) => {
  add(fixed("zone_duration_ms", "羊灵生息区域持续（毫秒）", "INTEGER", toMs(dataAt("Kindred", "R", "BuffDuration")), "正文明确4秒。", 10));
  add(skill("ending_heal", "区域结束治疗", "INTEGER", levels("Kindred", "R", "HealFlat", 3), "HealFlat使用技能等级索引1至3：225/300/375。", 20));
  add(fixed("health_floor_ratio", "停止伤害和治疗生命比例", "DECIMAL", 0.1, "官方正文明确降至10%生命时停止接受伤害或治疗。", 30));
  add(fixed("aoe_radius", "区域半径", "INTEGER", dataAt("Kindred", "R", "AoERadius"), "当前根AoERadius=530。", 40));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Kindred", "R").spellCastTime), "当前根spellCastTime=0.25秒。", 50));
  addFormula(formula("ending_heal", "羊灵生息结束治疗", P("ending_heal"), "区域结束时对仍在区域内、满足目标资格的单位治疗225/300/375。", 10));
}, [
  { item: "区域内额外敌人和友方分配", reason: "本轮只保留自身与唯一敌人边界。" },
], [
  { item: "双方目标资格、10%生命地板和结束时点", reason: "不能简化为全程无敌或只有自身治疗，事件待接。" },
], "自身和唯一敌人的共同区域边界、10%地板和结束治疗均保留。 ");

// 纳亚菲利
define("Naafiri", "P", "狂烈种群", 1, () => {}, [
  { item: "犬群生成、攻击、狂暴、召回、防护和野怪修正", reason: "自主召唤物系统跳过，不当作本体生命回复或本体伤害。" },
], [{ item: "本体与犬群事件", reason: "根绑定和完整原文保留在source，六类写入数组为空。" }], "P槽按范围要求保持空组成，不制造零值占位。 ");

define("Naafiri", "Q", "暗裔犬牙", 5, (add, addFormula, addEffect) => {
  add(skill("first_cast_base_damage", "暗裔犬牙第一刀基础物理伤害", "INTEGER", levels("Naafiri", "Q", "BaseDamageFirstCast", 5), "第一刀基础值索引1至5：35/40/45/50/55。", 10));
  add(fixed("first_cast_bonus_ad_ratio", "第一刀额外攻击力倍率", "DECIMAL", dataAt("Naafiri", "Q", "FirstCastBonusADRatio"), "第一刀读取来源额外攻击力，倍率0.2。", 20));
  add(skill("bleed_base_damage", "流血全程基础物理伤害", "INTEGER", levels("Naafiri", "Q", "BleedBaseDamage", 5), "流血全程值索引1至5：35/60/85/110/135。", 30));
  add(fixed("bleed_bonus_ad_ratio", "流血额外攻击力倍率", "DECIMAL", dataAt("Naafiri", "Q", "BleedBonusADRatio"), "流血全程读取来源额外攻击力，倍率0.8。", 40));
  add(fixed("bleed_duration_ms", "流血持续（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "Q", "BleedDuration")), "正文明确5秒。", 50));
  add(fixed("bleed_interval_ms", "流血原始间隔（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "Q", "BleedInterval")), "只记录来源0.5秒时序，不把全程值乘10。", 60));
  add(skill("second_cast_min_base_damage", "第二刀最小基础物理伤害", "DECIMAL", levels("Naafiri", "Q", "BaseDamageSecondCast", 5), "第二刀最小值索引1至5：30/42.5/55/67.5/80。", 70));
  add(fixed("second_cast_bonus_ad_ratio", "第二刀最小额外攻击力倍率", "DECIMAL", dataAt("Naafiri", "Q", "SecondCastBonusADRatio"), "第二刀最小式读取来源额外攻击力，倍率0.4。", 80));
  add(fixed("second_cast_max_bonus_ad_ratio", "第二刀最大额外攻击力倍率", "DECIMAL", dataAt("Naafiri", "Q", "SecondCastMaxADRatio"), "最大式内部为同一基础值+0.7×来源额外攻击力。", 90));
  add(fixed("execute_multiplier", "第二刀最大伤害乘数", "DECIMAL", dataAt("Naafiri", "Q", "ExecuteMultiplier"), "最大式整体乘2；不把最小完整式乘2。", 100));
  add(skill("second_cast_heal_base", "第二刀对英雄自身治疗基础值", "INTEGER", levels("Naafiri", "Q", "BaseHealSecondCast", 5), "对已流血英雄治疗基础值索引1至5：45/60/75/90/105。", 110));
  add(fixed("second_cast_heal_bonus_ad_ratio", "第二刀自身治疗额外攻击力倍率", "DECIMAL", dataAt("Naafiri", "Q", "HealBonusADRatio"), "治疗读取来源额外攻击力，倍率0.4。", 120));
  add(fixed("recast_window_ms", "第二次施放窗口（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "Q", "RecastWindow")), "正文明确4秒再施窗口。", 130));
  add(fixed("recast_lockout_ms", "第二次施放间隔（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "Q", "RecastLockout")), "正文明确0.75秒间隔。", 140));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", 250, "当前根正文补核明确250毫秒。", 150));
  const first = ADD(P("first_cast_base_damage"), MUL(P("first_cast_bonus_ad_ratio"), bonusAD()));
  const bleed = ADD(P("bleed_base_damage"), MUL(P("bleed_bonus_ad_ratio"), bonusAD()));
  const minSecond = ADD(P("second_cast_min_base_damage"), MUL(P("second_cast_bonus_ad_ratio"), bonusAD()));
  const maxSecondInner = ADD(P("second_cast_min_base_damage"), MUL(P("second_cast_max_bonus_ad_ratio"), bonusAD()));
  addFormula(formula("first_cast_physical_damage", "暗裔犬牙第一刀物理伤害", first, "第一刀=基础值+0.2×来源额外攻击力。", 10));
  addFormula(formula("bleed_total_physical_damage", "暗裔犬牙流血全程物理伤害", bleed, "流血全程=基础值+0.8×来源额外攻击力；0.5秒只是间隔，不乘总值。", 20));
  addFormula(formula("second_cast_min_physical_damage", "暗裔犬牙第二刀最小物理伤害", minSecond, "第二刀最小值=基础值+0.4×来源额外攻击力。", 30));
  addFormula(formula("second_cast_max_physical_damage", "暗裔犬牙第二刀最大物理伤害", MUL(P("execute_multiplier"), maxSecondInner), "第二刀最大值=2×(同一基础值+0.7×来源额外攻击力)。", 40));
  addFormula(formula("second_cast_self_heal", "暗裔犬牙第二刀自身治疗", ADD(P("second_cast_heal_base"), MUL(P("second_cast_heal_bonus_ad_ratio"), bonusAD())), "对已流血英雄治疗=基础值+0.4×来源额外攻击力。", 50));
  addEffect(resourceEffect("naafiri_q", "mana", "mana_cost"));
}, [
  { item: "犬群跃击和小兵处决", reason: "自主召唤输出或兵线专用。" },
], [{ item: "已流血条件、剩余流血结算与治疗资格", reason: "基础式和窗口已保留，条件事件待接。" }], "第二刀最大式与最小式分开，流血保留全程值与间隔单位。 ");

define("Naafiri", "W", "暴吼", 5, (add, addFormula, addEffect) => {
  add(fixed("untargetable_duration_ms", "自身不可选取持续（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "W", "UntargetableDuration")), "正文明确1秒。", 10));
  add(fixed("bonus_ad_ratio", "自身总攻击力增益比例", "DECIMAL", dataAt("Naafiri", "W", "NaafiriADPercentBoost"), "正文明确获得20%总攻击力，属性点效果使用attribute_flat_add。", 20));
  add(skill("move_speed_ratio", "自身移动速度比例", "DECIMAL", levels("Naafiri", "W", "MoveSpeedAmount", 5), "正文20/22.5/25/27.5/30%，按比例属性记录为0.2至0.3。", 30));
  add(fixed("duration_ms", "强化持续（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "W", "Duration")), "正文明确5秒。", 40));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Naafiri", "W").spellCastTime), "当前根mCastTime和spellCastTime均为0.75秒。", 50));
  addFormula(formula("self_attack_damage_bonus", "暴吼自身攻击力增益", MUL(P("bonus_ad_ratio"), totalAD()), "BonusAD=0.2×来源总攻击力。", 10));
  addEffect(attributeEffect("self_attack_damage", "暴吼自身攻击力增益", "attack_damage", "FORMULA", "self_attack_damage_bonus", "duration_ms", 20));
  addEffect(attributeEffect("self_move_speed", "暴吼自身移动速度增益", "move_speed_percent", "PARAMETER", "move_speed_ratio", "duration_ms", 30, "移动速度自身是比例属性，直接按0.2至0.3写入attribute_flat_add。"));
  addEffect(resourceEffect("naafiri_w", "mana", "mana_cost"));
}, [
  { item: "额外犬群、犬群不可选取和召回", reason: "自主召唤物系统跳过。" },
], [{ item: "根槽换名", reason: "当前NaafiriR根绑定对应本槽暴吼，按当前根而非旧槽名处理。" }], "W槽按当前根NaafiriR记录暴吼，保留自身不可选取、总攻击力增益和移速。 ");

define("Naafiri", "E", "剔骨本能", 5, (add, addFormula, addEffect) => {
  add(skill("first_slash_base_damage", "剔骨本能第一段基础物理伤害", "INTEGER", levels("Naafiri", "E", "BaseDamageFirstSlash", 5), "第一段基础值索引1至5：15/25/35/45/55。", 10));
  add(fixed("first_slash_bonus_ad_ratio", "第一段额外攻击力倍率", "DECIMAL", dataAt("Naafiri", "E", "ADRatioFirstSlash"), "第一段读取来源额外攻击力，倍率0.4。", 20));
  add(skill("second_hit_base_damage", "剔骨本能第二段基础物理伤害", "INTEGER", levels("Naafiri", "E", "BaseDamageSecondHit", 5), "第二段基础值索引1至5：60/85/110/135/160。", 30));
  add(fixed("second_hit_bonus_ad_ratio", "第二段额外攻击力倍率", "DECIMAL", dataAt("Naafiri", "E", "ADRatioSecondHit"), "第二段读取来源额外攻击力，倍率0.8。", 40));
  add(fixed("dash_distance", "冲刺距离", "INTEGER", dataAt("Naafiri", "E", "DashDistance"), "当前根DashDistance=450。", 50));
  add(fixed("dash_speed", "冲刺速度", "INTEGER", dataAt("Naafiri", "E", "DashSpeed"), "当前根DashSpeed=900。", 60));
  addFormula(formula("first_slash_physical_damage", "剔骨本能第一段物理伤害", ADD(P("first_slash_base_damage"), MUL(P("first_slash_bonus_ad_ratio"), bonusAD())), "第一段=基础值+0.4×来源额外攻击力。", 10));
  addFormula(formula("second_hit_physical_damage", "剔骨本能第二段物理伤害", ADD(P("second_hit_base_damage"), MUL(P("second_hit_bonus_ad_ratio"), bonusAD())), "第二段=基础值+0.8×来源额外攻击力。", 20));
  addEffect(resourceEffect("naafiri_e", "mana", "mana_cost"));
}, [
  { item: "犬群100%治疗", reason: "明确是犬群恢复，不录为自身回复。" },
], [{ item: "两段同敌碰撞顺序", reason: "同一敌人两段伤害均保留，但不默认必全中；距离450和速度900分开记录。" }], "保留本体两段伤害和唯一敌人可能两段命中，不把犬群恢复混入本体。 ");

define("Naafiri", "R", "猎狗血性", 3, (add, addFormula, addEffect) => {
  add(skill("base_damage", "猎狗血性本体基础物理伤害", "INTEGER", levels("Naafiri", "R", "BaseDamage", 3), "TotalDamage使用当前根DataValues.BaseDamage索引1至3：125/200/275。", 10));
  add(fixed("bonus_ad_ratio", "本体额外攻击力倍率", "DECIMAL", 1, "TotalDamage当前根mStat=2系数1，读取来源额外攻击力。", 20));
  add(fixed("slow_percent_points", "短暂减速百分数点", "INTEGER", 99, "原始SlowPercent约-0.99，按当前中文‘短暂减速’保留99百分数点；实际执行资格待接。", 30));
  add(fixed("slow_duration_ms", "短暂减速持续（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "R", "SlowDuration")), "原始SlowDuration=0.25秒。", 40));
  add(fixed("takedown_window_ms", "参与击杀窗口（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "R", "TakedownWindow")), "正文明确7秒。", 50));
  add(fixed("recast_window_ms", "额外再施窗口（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "R", "RecastWindow")), "正文明确可再次施放的12秒窗口。", 60));
  add(skill("shield_base", "第二次施放护盾基础值", "INTEGER", levels("Naafiri", "R", "ShieldSize", 3), "ShieldTotal使用索引1至3：100/150/200；索引0的50不作技能1级。", 70));
  add(fixed("shield_bonus_ad_ratio", "第二次施放护盾额外攻击力倍率", "DECIMAL", coefficient("Naafiri", "R", "ShieldTotal"), "ShieldTotal系数1.5，读取来源额外攻击力。", 80));
  add(fixed("shield_duration_ms", "第二次施放护盾持续（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "R", "ShieldDuration")), "正文明确3秒。", 90));
  add(fixed("w_refresh_extension_ms", "暴吼延长原始值（毫秒）", "INTEGER", toMs(dataAt("Naafiri", "R", "WRefreshOnCast")), "正文只说短暂延长暴吼，原始1.75秒的算法未证，不当作已接刷新。", 100));
  add(fixed("channel_duration_ms", "引导持续（毫秒）", "INTEGER", toMs(spell("Naafiri", "R").mChannelDuration[0]), "当前根mChannelDuration各等级均为0.75秒；与spellCastTime=0字段分开。", 110));
  addFormula(formula("body_physical_damage", "猎狗血性本体物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "TotalDamage=基础值+来源额外攻击力；犬群伤害排除。", 10));
  addFormula(formula("second_cast_shield", "猎狗血性第二次施放自身护盾", ADD(P("shield_base"), MUL(P("shield_bonus_ad_ratio"), bonusAD())), "ShieldTotal=基础值+1.5×来源额外攻击力。", 20));
  addEffect(shieldEffect("self_shield", "猎狗血性第二次施放自身护盾", "second_cast_shield", "shield_duration_ms", 20));
  addEffect(resourceEffect("naafiri_r", "mana", "mana_cost"));
}, [
  { item: "犬群额外伤害和纯视野显形", reason: "自主召唤输出或纯视野。" },
  { item: "ArmorShred旧树", reason: "当前正文和消费树未消费。" },
], [
  { item: "99%短暂减速实际资格", reason: "原始数值和正文边界保留，命中执行待接。" },
  { item: "WRefreshOnCast延长算法", reason: "保留1.75秒原始值，不把它伪装成已接刷新。" },
], "R槽按当前根NaafiriW记录猎狗血性，保留本体伤害、单敌参与击杀再施与自身护盾。 ");

// 劫
define("Zed", "P", "影忍法！灭魂劫", 1, (add, addFormula) => {
  add(fixed("target_current_health_threshold_ratio", "目标当前生命触发阈值", "DECIMAL", dataAt("Zed", "P", "CurrentHealthThreshold"), "正文明确目标低于50%当前生命。", 10));
  add(runtime("actual_target_current_health_ratio", "当前目标生命比例", "DECIMAL", "低于50%的触发资格需要运行层提供目标当前生命比例，不设默认。", 20));
  add(fixed("per_target_cooldown_ms", "同一目标被动冷却（毫秒）", "INTEGER", toMs(dataAt("Zed", "P", "PerUnitCD")), "正文明确同一敌方英雄10秒内只触发一次。", 30));
  add(character("max_health_damage_ratio", "目标最大生命魔法伤害比例", "DECIMAL", Object.fromEntries([
    ...Array.from({ length: 6 }, (_, index) => [String(index + 1), 0.05]),
    ...Array.from({ length: 10 }, (_, index) => [String(index + 7), 0.075]),
    ["17", 0.1], ["18", 0.1],
  ]), "客户端角色等级断点：1至6级5%，7至16级7.5%，17至18级10%；只展开纯加法断点，不线性插值。", 40));
  add(fixed("shen_zed_quest_bonus_cap_ratio", "慎劫任务增益上限比例", "DECIMAL", 0.02, "ShenZedQuestBonus原始值约0.02；这是已知战斗增益上限。", 50));
  add(runtime("actual_shen_zed_quest_bonus_ratio", "当前慎劫任务增益比例", "DECIMAL", "当前匿名条件是否成立未证；运行层提供实际0至0.02增益，不设默认，不能凭空常驻加2%。", 60));
  addFormula(formula("base_max_health_magic_damage", "灭魂劫基础最大生命魔法伤害", MUL(P("max_health_damage_ratio"), targetHP()), "MaxHPDamage基础分支=当前角色等级比例×目标最大生命。", 10));
  addFormula(formula("quest_max_health_magic_damage", "灭魂劫慎劫条件最大生命魔法伤害", MUL(ADD(P("max_health_damage_ratio"), P("actual_shen_zed_quest_bonus_ratio")), targetHP()), "条件分支=基础比例+当前具名任务增益×目标最大生命；条件资格待接。", 20));
}, [
  { item: "野怪修正和史诗野怪上限", reason: "野怪专用。" },
  { item: "任务剧情、击杀计数和常驻2%", reason: "保留具名无默认实际增益，不实现任务剧情或常驻加成。" },
], [
  { item: "低于50%当前生命、同敌冷却和慎劫条件", reason: "阈值、冷却和条件输入已记录，触发事件待接。" },
], "P保留当前目标最大生命伤害与确实消费的慎劫2%具名输入；目标当前生命资格不写成默认。 ");

define("Zed", "Q", "影奥义！诸刃", 5, (add, addFormula, addEffect) => {
  add(skill("base_damage", "诸刃本体首目标基础物理伤害", "INTEGER", levels("Zed", "Q", "BaseDamage", 5), "TotalDamage使用DataValues.BaseDamage索引1至5：80/120/160/200/240。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", dataAt("Zed", "Q", "BonusADRatio"), "TotalDamage读取来源额外攻击力，倍率1。", 20));
  add(skill("energy_cost", "诸刃能量消耗", "INTEGER", [75, 70, 65, 60, 55].reduce((out, value, index) => ({ ...out, [String(index + 1)]: value }), {}), "当前根资源为能量，索引0起的75/70/65/60/55；不命名为法力。", 30));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Zed", "Q").spellCastTime), "当前根spellCastTime=0.25秒。", 40));
  addFormula(formula("body_physical_damage", "诸刃本体首目标物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "本体首目标=基础值+额外攻击力；后续目标60%和影分身复制输出排除。", 10));
  addEffect(resourceEffect("zed_q", "energy", "energy_cost"));
}, [
  { item: "后续目标60%衰减", reason: "本轮唯一敌人只取首目标。" },
  { item: "影分身复制输出", reason: "完整影分身输出链跳过。" },
], [], "只录劫本体对唯一首目标的诸刃伤害与能量消耗。 ");

define("Zed", "W", "影奥义！分身", 5, (add, addFormula, addEffect) => {
  add(fixed("recast_range", "分身突进距离", "INTEGER", dataAt("Zed", "W", "RecastRange"), "当前根RecastRange=2000。", 10));
  add(fixed("shadow_duration_tooltip_ms", "分身显示存在持续（毫秒）", "INTEGER", toMs(dataAt("Zed", "W", "ShadowDurationTooltip")), "当前正文显示5秒。", 20));
  add(fixed("shadow_duration_internal_ms", "分身内部存在持续（毫秒）", "INTEGER", toMs(dataAt("Zed", "W", "ShadowDuration")), "当前根原始5.25秒；与显示值和换位窗口分开。", 30));
  add(fixed("swap_window_ms", "换位窗口原始持续（毫秒）", "INTEGER", toMs(dataAt("Zed", "W", "SwapTimeLimit")), "当前根原始5.25秒；不擅自与显示存在值同义。", 40));
  add(skill("energy_cost", "分身能量消耗", "INTEGER", [40, 35, 30, 25, 20].reduce((out, value, index) => ({ ...out, [String(index + 1)]: value }), {}), "当前根能量消耗40/35/30/25/20。", 50));
  add(skill("energy_restore_double_hit", "同技能双命中能量返还", "INTEGER", levels("Zed", "W", "EnergyRestoreDoubleHit", 5), "当前正文双命中返还30/35/40/45/50；依赖本体与分身同技能命中一次。", 60));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Zed", "W").spellCastTime), "当前根spellCastTime=0.25秒。", 70));
  addEffect(resourceEffect("zed_w", "energy", "energy_cost"));
}, [
  { item: "分身额外攻击主体与复制输出", reason: "影分身输出链跳过。" },
], [
  { item: "本体换位和双命中返能资格", reason: "距离、显示/内部持续和能量返还数值保留；双命中事件待接。" },
], "保留W本体换位边界和双命中返能依赖，不伪造独立分身伤害。 ");

define("Zed", "E", "影奥义！鬼斩", 5, (add, addFormula, addEffect) => {
  add(skill("base_damage", "鬼斩本体基础物理伤害", "DECIMAL", levels("Zed", "E", "BaseDamage", 5), "TotalDamage使用DataValues.BaseDamage索引1至5：70/92.5/115/137.5/160。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", dataAt("Zed", "E", "ADRatio"), "TotalDamage读取来源额外攻击力，倍率0.7。", 20));
  add(fixed("energy_cost", "鬼斩能量消耗", "INTEGER", 40, "当前根能量消耗40；不命名为法力。", 30));
  add(fixed("shadow_hit_cdr_ms", "本体命中后W冷却缩短（毫秒）", "INTEGER", toMs(dataAt("Zed", "E", "ShadowHitCDR")), "本体命中当前敌方英雄使W冷却缩短3秒。", 40));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Zed", "E").spellCastTime), "当前根spellCastTime=0.25秒。", 50));
  addFormula(formula("body_physical_damage", "鬼斩本体物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "本体=基础值+0.7×来源额外攻击力；相同敌人多个E不增加伤害。", 10));
  addEffect(cooldownEffect("reduce_w_cooldown", "鬼斩本体命中缩短分身冷却", "shadow_hit_cdr_ms", ["zed_w"], 20));
  addEffect(resourceEffect("zed_e", "energy", "energy_cost", 910));
}, [
  { item: "分身20至40%减速、叠加减速和分身伤害", reason: "只属于影分身复制链；本体不带分身减速。" },
], [{ item: "本体命中当前敌方英雄的W冷却修正事件", reason: "效果作用范围已写为指定zed_w，命中事件待接。" }], "保留本体鬼斩伤害、能量和对W的明确冷却修正，跳过分身减速。 ");

define("Zed", "R", "禁奥义！瞬狱影杀阵", 3, (add, addFormula) => {
  add(skill("damage_amp", "死亡印记额外伤害比例", "DECIMAL", levels("Zed", "R", "RDamageAmp", 3), "RDamageAmp使用索引1至3：25%/40%/55%。", 10));
  add(fixed("total_ad_ratio", "印记基础总攻击力倍率", "DECIMAL", 1, "RCalculatedDamage当前树系数1，读取来源总攻击力。", 20));
  add(fixed("mark_duration_ms", "死亡印记持续（毫秒）", "INTEGER", toMs(dataAt("Zed", "R", "RDeathMarkDuration")), "正文明确3秒；不把7.5秒换位窗口当印记持续。", 30));
  add(fixed("recast_lock_ms", "再次施放锁定（毫秒）", "INTEGER", toMs(dataAt("Zed", "R", "RReactivateCD")), "正文和当前根明确0.5秒。", 40));
  add(fixed("swap_window_ms", "分身换位窗口（毫秒）", "INTEGER", toMs(dataAt("Zed", "R", "RCanSwapBuffDuration")), "当前根明确7.5秒；不是死亡印记持续。", 50));
  add(fixed("shadow_duration_displayed_ms", "突进后分身显示持续（毫秒）", "INTEGER", toMs(dataAt("Zed", "R", "RShadowDurationDisplayed")), "官方正文显示7.5秒换位窗口边界，分身额外1.5秒另记。", 60));
  add(fixed("delayed_shadow_linger_ms", "换位窗口后分身额外存在（毫秒）", "INTEGER", 1500, "官方中文当前文本明确换位时间窗口结束后额外存留1.5秒。", 70));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Zed", "R").spellCastTime), "当前根spellCastTime=0.25秒。", 80));
  add(runtime("qualified_body_damage", "印记激活期间合格本体伤害总和", "DECIMAL", "R爆炸需要印记激活期间折算阶段明确的本体伤害总和；折前折后、伤害种类和装备归属未证，不设默认。", 90));
  const markBase = MUL(P("total_ad_ratio"), totalAD());
  addFormula(formula("mark_base_physical_damage", "死亡印记基础物理伤害", markBase, "RCalculatedDamage=来源总攻击力。", 10));
  addFormula(formula("detonation_physical_damage", "死亡印记爆炸物理伤害", ADD(markBase, MUL(P("damage_amp"), P("qualified_body_damage"))), "爆炸=总攻击力+25/40/55%合格标记期本体伤害；不混入分身输出。", 20));
}, [
  { item: "影分身复制输出、匿名加0.5旧树和偷取攻击力", reason: "分身链、未消费匿名树和当前不消费的永久收益排除。" },
], [
  { item: "合格标记期本体伤害阶段", reason: "使用无默认运行输入，等待折前折后和伤害种类边界。" },
  { item: "延后分身存在与匿名树冲突", reason: "1.5秒官方文本保留，匿名7.5+0.5旧树不消费。" },
], "保留劫R本体突进后的3秒印记、总攻击力基底、25/40/55%本体伤害加成和独立时间窗口。 ");

const order = [
  "gangplank_p", "gangplank_q", "gangplank_w", "gangplank_e", "gangplank_r",
  "kindred_p", "kindred_q", "kindred_w", "kindred_e", "kindred_r",
  "naafiri_p", "naafiri_q", "naafiri_w", "naafiri_e", "naafiri_r",
  "zed_p", "zed_q", "zed_w", "zed_e", "zed_r",
];
const kindMap = {
  parameters: "newParameters",
  formulas: "newFormulas",
  effects: "newEffects",
  processes: "newProcesses",
  internalStates: "newInternalStates",
  triggerRules: "newTriggerRules",
};
const visitExpression = (node, context) => {
  if (!node || typeof node !== "object") return;
  if (node.nodeType === "OPERATION" && (!Array.isArray(node.operands) || node.operands.length !== 2)) {
    throw new Error(`公式必须恰好两个操作数：${context}`);
  }
  if (Array.isArray(node.operands)) node.operands.forEach(child => visitExpression(child, context));
};
for (const key of order) {
  const write = defs[key].write;
  for (const item of write.formulas) visitExpression(item.expression, `${key}/${item.formulaKey}`);
  for (const item of write.parameters) {
    const values = item.valueMode === "FIXED" ? [item.fixedValue] : Object.values(item.levelValues || {});
    if (item.valueType === "INTEGER" && values.some(value => value !== null && !Number.isInteger(value))) {
      throw new Error(`INTEGER不合规：${key}/${item.parameterKey}`);
    }
    if (item.parameterKey.endsWith("_ms") && values.some(value => value !== null && (!Number.isInteger(value) || value < 0))) {
      throw new Error(`毫秒参数不合规：${key}/${item.parameterKey}`);
    }
    if (item.valueMode === "RUNTIME_INPUT" && (item.fixedValue !== null || item.levelValues !== null)) {
      throw new Error(`运行输入不能带默认值：${key}/${item.parameterKey}`);
    }
    if (item.valueMode !== "RUNTIME_INPUT" && item.fixedValue === null && item.levelValues === null) {
      throw new Error(`参数没有值模式数据：${key}/${item.parameterKey}`);
    }
  }
}

const reusedPublicParameters = reuseList.map(item => {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const hit = protection.requests.find(request => request.route === route);
  if (!hit) throw new Error(`公共参数保护缺失：${route}`);
  return {
    skillKey: item.skillKey,
    parameterKey: item.parameterKey,
    source: "输入包/参考资料/公共参数复用清单.json",
    post: false,
    detailRoute: route,
    expected: clone(hit.data),
    expectedSha256: sha256(JSON.stringify(hit.data)),
  };
});

const sourceFiles = inputVersion.sourceFiles.map(item => {
  const file = path.join(INPUT, item.path.replaceAll("/", path.sep));
  return { path: `hero43-root-entry-20260910/${item.path}`, role: item.role, sha256: shaFile(file), byteSize: fs.statSync(file).size };
});
for (const [relative, file, role] of [
  ["来源绑定与当前文本.json", bindingFile, "当前绑定与原始对象索引"],
  ["输入版本.json", versionFile, "输入版本"],
  ["主负责人范围与核对要求.md", rangeFile, "主负责人范围要求"],
  ["主负责人源值核对说明.md", auditFile, "主负责人源值补核"],
  ["README.md", inputReadmeFile, "输入说明"],
]) sourceFiles.push({ path: `hero43-root-entry-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });
for (const [relative, file, role] of [
  ["Cursor来源复核结论.md", cursorConclusionFile, "Cursor来源复核结论"],
  ["主负责人执行审计.json", cursorAuditFile, "Cursor执行审计元数据"],
]) sourceFiles.push({ path: `hero43-cursor-review-run-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });

const hashes = {
  sourceBindingSha256: shaFile(bindingFile),
  sourceRangeSha256: shaFile(rangeFile),
  sourceAuditSha256: shaFile(auditFile),
  cursorConclusionSha256: shaFile(cursorConclusionFile),
  cursorAuditSha256: shaFile(cursorAuditFile),
  protectionSnapshotSha256: shaFile(protectionFile),
  publicReuseSha256: shaFile(reuseFile),
  inputVersionSha256: shaFile(versionFile),
  attributeNarrowSha256: shaFile(attributeFile),
  payloadSampleSha256: shaFile(payloadFile),
};

const generatedAt = new Date().toISOString();
const candidate = {
  meta: {
    generatedAt,
    batch: BATCH,
    revision: REVISION,
    status: "候选已生成，等待主负责人审查；未调用业务接口",
    gameId: "lol",
    apiBase: API_BASE,
    sourceVersion: { clientVersion: binding.clientVersion, officialVersion: binding.officialVersion, build: heroes.Gangplank.source.client.contentVersion },
    sourcePolicy: "固定客户端16.17、官方16.17.1、当前根绑定正文和原始计算树；明确值入候选，未知属性、曲线、事件、跨技能资格和目标阶段使用有名无默认输入。",
    scope: "普朗克、千珏、纳亚菲利、劫20个技能槽；一对一唯一敌方范围。保留本体与唯一敌人的伤害、治疗护盾、移动、资源和属性；桶、犬群、影分身等自主输出跳过，根绑定和本体机制分别保留。",
    ...hashes,
    inputGETs: inputVersion.GETs,
    currentGETs: inputVersion.GETs,
    reusedPublicParameterCount: inputVersion.reusedParameters,
    apiCalls: 0,
    businessWrites: 0,
    noBusinessWrites: true,
    tokenStored: false,
    candidateSha256: null,
    sourceReview: {
      conclusionFile: ".agents/artifacts/hero43-cursor-review-run-20260910/Cursor来源复核结论.md",
      auditFile: ".agents/artifacts/hero43-cursor-review-run-20260910/主负责人执行审计.json",
      verdict: "READY",
      events: 6633,
      uniqueReadOnlyCalls: 51,
      frozenInputs: 23,
      apiWrites: 0,
      gitChanges: 0,
      note: "主负责人源值核对说明晚于Cursor复核，遇差异依该说明和当前根对象处理。",
    },
    inputPackage: ".agents/artifacts/hero43-root-entry-20260910",
  },
  skills: Object.fromEntries(order.map(key => [key, defs[key]])),
  order,
  reusedPublicParameters,
  reusedExistingParameters: clone(reusedPublicParameters),
  counts: {
    newParameters: 0,
    newFormulas: 0,
    newEffects: 0,
    newProcesses: 0,
    newInternalStates: 0,
    newTriggerRules: 0,
    newTotal: 0,
    reusedPublicParameters: reusedPublicParameters.length,
    plannedTotalIncludingReused: 0,
    protectedCurrentCompositionLists: protection.requests.filter(item => /\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(item.route)).length,
  },
  apiWrites: 0,
  sourceFiles,
  sourceNotes: {
    fixedClient: "输入包/参考资料/客户端原文/*.json.gz，客户端16.17完整对象",
    fixedOfficial: "输入包/参考资料/官方中文与官方英文，官方16.17.1",
    currentText: "输入包/来源绑定与当前文本.json的当前根绑定正文",
    attributes: "输入包/参考资料/属性默认与边界.json只用于窄映射，未知阶段保持运行输入",
    payload: "输入包/参考资料/接口载荷样例.json只作结构参考，不复制数值",
  },
  protectedObjects: {
    snapshot: "输入包/参考资料/当前20槽保护快照.json",
    snapshotSha256: hashes.protectionSnapshotSha256,
    inputGETs: protection.GETs,
    requestCount: protection.requests.length,
    routes: protectedRouteHashes,
    publicReuse: clone(reusedPublicParameters),
    note: "属性、技能分类、乘区、伤害类型、角色、关系、20个主体、图片和120条六类列表只读保护；24项公共参数只读复用。",
  },
  revision: REVISION,
};
for (const key of order) for (const [kind, countKey] of Object.entries(kindMap)) candidate.counts[countKey] += defs[key].write[kind].length;
candidate.counts.newTotal = candidate.counts.newParameters + candidate.counts.newFormulas + candidate.counts.newEffects + candidate.counts.newProcesses + candidate.counts.newInternalStates + candidate.counts.newTriggerRules;
candidate.counts.plannedTotalIncludingReused = candidate.counts.newTotal + candidate.counts.reusedPublicParameters;
const candidateBytes = jsonBytes(candidate);
const candidateSha256 = sha256(candidateBytes);

const scope = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "来源值与录入范围清单；未调用业务接口",
  inputGETs: inputVersion.GETs,
  reusedPublicParameters: reusedPublicParameters.length,
  sourceBindingSha256: hashes.sourceBindingSha256,
  sourceRangeSha256: hashes.sourceRangeSha256,
  sourceAuditSha256: hashes.sourceAuditSha256,
  cursorConclusionSha256: hashes.cursorConclusionSha256,
  sourceReviewVerdict: "READY",
  fixedVersions: { client: binding.clientVersion, official: binding.officialVersion, build: heroes.Gangplank.source.client.contentVersion },
  skills: Object.fromEntries(order.map(key => [key, {
    recordableParameters: defs[key].write.parameters.map(item => item.parameterKey),
    recordableFormulas: defs[key].write.formulas.map(item => item.formulaKey),
    recordableEffects: defs[key].write.effects.map(item => item.effectKey),
    excluded: clone(defs[key].excluded),
    pending: clone(defs[key].pending),
    currentSubjectProtected: defs[key].protectedExisting.subject,
  }])),
  globalScope: {
    included: ["本体和唯一敌人的伤害", "自身治疗与护盾", "自身移动和比例属性", "本体资源消耗", "明确指定技能冷却变化"],
    excluded: ["纯经验金币", "纯视野", "兵野专用", "第三友方分配", "额外敌人分配", "桶/犬群/影分身自主输出"],
    unknownPolicy: "未知等级曲线、实际伤害阶段、目标资格和事件时序用无默认运行输入或pending记录，不以0占位。",
  },
  noApiCalls: true,
  apiWrites: 0,
};
const scopeBytes = jsonBytes(scope);
const scopeSha256 = sha256(scopeBytes);

const requests = [];
for (const key of order) {
  for (const [kind, idField, apiName] of [
    ["parameters", "parameterKey", "parameters"],
    ["formulas", "formulaKey", "formulas"],
    ["effects", "effectKey", "effects"],
    ["processes", "processKey", "processes"],
    ["internalStates", "stateKey", "internal-states"],
    ["triggerRules", "ruleKey", "trigger-rules"],
  ]) for (const body of defs[key].write[kind]) requests.push({
    sequence: requests.length + 1,
    operation: "POST",
    method: "POST",
    route: `/skills/${key}/${apiName}`,
    detailRoute: `/skills/${key}/${apiName}/${body[idField]}`,
    skillKey: key,
    kind,
    stableKey: body[idField],
    status: "仅意图，未调用",
    body: clone(body),
  });
}
if (requests.length !== candidate.counts.newTotal) throw new Error("POST计划数量与候选数量不符");
const plan = {
  generatedAt: generatedAt,
  status: "仅写入意图，未调用业务接口",
  batch: BATCH,
  revision: REVISION,
  apiBase: API_BASE,
  sourceVersion: clone(candidate.meta.sourceVersion),
  candidateSha256,
  sourceBindingSha256: hashes.sourceBindingSha256,
  sourceRangeSha256: scopeSha256,
  inputSourceRangeSha256: hashes.sourceRangeSha256,
  sourceAuditSha256: hashes.sourceAuditSha256,
  protectionSnapshotSha256: hashes.protectionSnapshotSha256,
  publicReuseSha256: hashes.publicReuseSha256,
  requestCount: requests.length,
  counts: clone(candidate.counts),
  reusedPublicParameters: clone(reusedPublicParameters),
  protectedRoutes: protectedRouteHashes,
  protectedSummary: { inputGETs: protection.GETs, inputRequestCount: protection.requests.length, currentCompositionLists: candidate.counts.protectedCurrentCompositionLists, note: "写入前逐条只读保护；本计划不覆盖已有组成。" },
  requests,
  noApiCalls: true,
  apiWrites: 0,
  businessWrites: 0,
};
const planBytes = jsonBytes(plan);
const planSha256 = sha256(planBytes);

const sourceValues = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "独立源值清单；未调用业务接口",
  sourceBindingSha256: hashes.sourceBindingSha256,
  sourceAuditSha256: hashes.sourceAuditSha256,
  sourceFiles: clone(sourceFiles),
  sourceValues: Object.fromEntries(order.map(key => {
    const value = defs[key].source;
    return [key, {
      hero: value.hero,
      heroName: value.heroName,
      slot: value.slot,
      rootPath: value.rootPath,
      spellPath: value.spellPath,
      currentText: clone(value.currentBoundText),
      officialZh: clone(value.officialEvidence.zh),
      officialEn: clone(value.officialEvidence.en),
      rawDataValues: clone(value.raw.dataValues),
      rawCalculations: clone(value.raw.calculations),
      rawFields: clone(value.raw.fields),
      selectedParameterKeys: defs[key].write.parameters.map(item => item.parameterKey),
      selectedFormulaKeys: defs[key].write.formulas.map(item => item.formulaKey),
      selectedEffectKeys: defs[key].write.effects.map(item => item.effectKey),
      excluded: clone(defs[key].excluded),
      pending: clone(defs[key].pending),
    }];
  })),
  noApiCalls: true,
  apiWrites: 0,
};
const sourceValuesBytes = jsonBytes(sourceValues);
const sourceValuesSha256 = sha256(sourceValuesBytes);

const sourceMathStatus = fs.existsSync(mathScriptFile) ? "脚本已生成，待执行" : "脚本待生成";
const version = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "候选冻结，待主负责人审查；未调用业务接口",
  candidateSha256,
  planSha256,
  scopeSha256,
  sourceValuesSha256,
  ...hashes,
  counts: clone(candidate.counts),
  requestCount: requests.length,
  sourceMath: "独立数学核算.mjs",
  sourceMathStatus,
  apiCalls: 0,
  businessWrites: 0,
  noBusinessWrites: true,
};
const generatorBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const mathBytes = fs.existsSync(mathScriptFile) ? fs.readFileSync(mathScriptFile) : Buffer.from("", "utf8");
const freezeNotice = {
  batch: BATCH,
  revision: REVISION,
  candidateSha256,
  planSha256,
  scopeSha256,
  sourceValuesSha256,
  counts: candidate.counts,
  requestCount: requests.length,
  inputGETs: inputVersion.GETs,
  reusedPublicParameters: reusedPublicParameters.length,
  apiCalls: 0,
  businessWrites: 0,
  status: "冻结候选，等待主负责人审查；未调用业务接口",
};
const freezeBytes = jsonBytes(freezeNotice);
const outputFiles = {
  "完整候选.json": { sha256: candidateSha256, byteSize: candidateBytes.length },
  "请求计划.json": { sha256: planSha256, byteSize: planBytes.length },
  "来源与范围.json": { sha256: scopeSha256, byteSize: scopeBytes.length },
  "来源值摘要.json": { sha256: sourceValuesSha256, byteSize: sourceValuesBytes.length },
  "候选版本.json": { sha256: sha256(jsonBytes(version)), byteSize: jsonBytes(version).length },
  "生成候选.mjs": { sha256: sha256(generatorBytes), byteSize: generatorBytes.length },
  "独立数学核算.mjs": { sha256: sha256(mathBytes), byteSize: mathBytes.length },
  "来源冻结通知.json": { sha256: sha256(freezeBytes), byteSize: freezeBytes.length },
};
const readme = [
  "# 第四十三批候选",
  "",
  "本目录保存普朗克、千珏、纳亚菲利、劫20个技能槽的候选组成。来源固定客户端16.17、官方16.17.1、当前根绑定正文和完整原始计算树；Cursor复核结论为READY，主负责人源值补核作为后置且更高优先级的约束。",
  "",
  "候选只计划新增六类组成。196次只读请求保护20个既有技能主体、图片、角色、关系、字典和120条六类列表；24项公共冷却或资源参数只读复用，均不生成POST。",
  "",
  "范围保留本体和唯一敌人的伤害、治疗护盾、移动、资源与属性。普朗克火药桶、纳亚菲利犬群、劫影分身等自主输出跳过；千珏E第三次普攻狼跃保留。纳亚菲利W/R按当前根NaafiriR/NaafiriW槽绑定。",
  "",
  "公式全部为二元操作。比例类属性move_speed_percent与bonus_attack_speed_percent用1表示100%，增量使用attribute_flat_add。未知等级曲线、目标资格、伤害阶段和事件时序使用无默认运行输入或pending说明，不用0占位。",
  "",
  "请求计划只保存POST意图，未调用业务接口、未写数据库、未执行浏览器或Git操作。独立数学核算脚本提供实际侧场景、期望侧原始值、缺值拒绝和效果倍率/属性单位核对。",
  "",
].join("\n");
const experience = [
  "# 第四十三批候选体验报告",
  "",
  "20个技能槽均保留当前根绑定、当前中文正文、官方中文/英文来源与既有主体保护证据；每槽均有六类write数组，空槽明确标出跳过原因。",
  "",
  "使用体验重点是把可直接核对的伤害式、自身治疗护盾、比例属性、资源和指定技能冷却变化分开。普朗克R的12波全程、千珏E两条同乘区暴击树、纳亚菲利Q第二刀最小/最大式、劫P的18级断点和劫R的合格本体伤害输入均可逐项复核。",
  "",
  "待接部分集中在运行事件：角色等级插值、印记/低血量/已流血/第三次攻击、区域目标资格、换位与分身双命中、击杀再施以及劫R标记期伤害阶段。候选保留原始边界和无默认输入，不把静态候选当作运行时或数据库证据。",
  "",
].join("\n");

const hashManifest = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  policy: "所有条目均按文件实际UTF-8或原始字节计算SHA-256；manifest自身与来源哈希汇总自身不纳入自身条目，避免循环。",
  files: outputFiles,
  inputFiles: sourceFiles,
  sourceHashes: hashes,
  apiCalls: 0,
  businessWrites: 0,
};
const sourceHashSummary = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  sourceHashes: hashes,
  inputFiles: sourceFiles,
  outputFiles,
  manifest: "文件散列.json",
  mathReport: "独立数学报告.json由独立数学核算.mjs执行后追加；追加后同步更新本文件与来源哈希汇总。",
  apiCalls: 0,
  businessWrites: 0,
};

fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(DURABLE, { recursive: true });
const outputPairs = [
  ["完整候选.json", candidateBytes],
  ["请求计划.json", planBytes],
  ["来源与范围.json", scopeBytes],
  ["来源值摘要.json", sourceValuesBytes],
  ["候选版本.json", jsonBytes(version)],
  ["来源哈希汇总.json", jsonBytes(sourceHashSummary)],
  ["文件散列.json", jsonBytes(hashManifest)],
  ["README.md", Buffer.from(readme, "utf8")],
  ["体验报告.md", Buffer.from(experience, "utf8")],
];
for (const [name, bytes] of outputPairs) {
  writeNew(path.join(ROOT, name), bytes);
  writeNew(path.join(DURABLE, name), bytes);
}
writeNew(path.join(DURABLE, "生成候选.mjs"), generatorBytes);
if (mathBytes.length > 0) writeNew(path.join(DURABLE, "独立数学核算.mjs"), mathBytes);
writeJsonNew(path.join(ROOT, "来源冻结通知.json"), freezeNotice);
writeJsonNew(path.join(DURABLE, "来源冻结通知.json"), freezeNotice);
console.log(JSON.stringify({
  revision: REVISION,
  candidateSha256,
  planSha256,
  scopeSha256,
  sourceValuesSha256,
  counts: candidate.counts,
  requestCount: requests.length,
  reusedPublicParameters: reusedPublicParameters.length,
  inputGETs: inputVersion.GETs,
  apiCalls: 0,
  businessWrites: 0,
  durable: DURABLE,
}, null, 2));
