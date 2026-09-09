import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero36-root-entry-20260910");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十六批");
const batch = "英雄机制第三十六批";
const revision = "hero36-source-v1-candidate";
const apiBase = "http://127.0.0.1:8080/api/admin/games/lol";
const generatedAt = new Date().toISOString();

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const sha256File = file => sha256(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const close = (a, b, tolerance = 1e-5) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const clean = value => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;
const assert = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(message + (detail === undefined ? "" : `：${JSON.stringify(detail)}`));
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
};
const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
};

const inputVersionPath = path.join(inputDir, "输入版本.json");
const bindingPath = path.join(inputDir, "来源绑定与当前文本.json");
const protectionPath = path.join(inputDir, "参考资料", "当前20槽保护快照.json");
const publicReusePath = path.join(inputDir, "参考资料", "公共参数复用清单.json");
const interfaceSamplePath = path.join(inputDir, "参考资料", "接口载荷样例.json");
const attributeBoundaryPath = path.join(inputDir, "参考资料", "属性默认与边界.json");
const rootReviewPath = path.join(inputDir, "主负责人源值核对说明.md");
const cursorReviewDir = path.join(repo, ".agents/artifacts/hero36-cursor-review-run-20260910");
const cursorReviewPath = path.join(cursorReviewDir, "Cursor来源复核结论.md");
const cursorAuditPath = path.join(cursorReviewDir, "主负责人执行审计.json");

const inputVersion = readJson(inputVersionPath);
const source = readJson(bindingPath);
const protection = readJson(protectionPath);
const publicReuse = readJson(publicReusePath);
const interfaceSample = readJson(interfaceSamplePath);
const attributeBoundary = readJson(attributeBoundaryPath);
const cursorAudit = readJson(cursorAuditPath);
const cursorReviewText = fs.readFileSync(cursorReviewPath, "utf8");

assert(source.clientVersion === "16.17" && source.officialVersion === "16.17.1", "冻结来源版本不符", { client: source.clientVersion, official: source.officialVersion });
assert(inputVersion.GETs === 202 && inputVersion.apiWrites === 0, "输入包不是202次只读GET", inputVersion);
assert(protection.GETs === 202 && protection.apiWrites === 0 && (protection.businessWrites === undefined || protection.businessWrites === 0), "保护快照不是只读202 GET", protection);
assert(inputVersion.reusedParameters === 30 && publicReuse.length === 30, "公共参数复用数量不符", { declared: inputVersion.reusedParameters, actual: publicReuse.length });
assert(cursorReviewText.includes("VERDICT: READY"), "Cursor来源复核不是READY");
assert(cursorAudit.readonlyAuditPassed === true && cursorAudit.apiWrites === 0 && Array.isArray(cursorAudit.gitDelta) && cursorAudit.gitDelta.length === 0, "Cursor只读审计不满足", cursorAudit);

const inputFiles = (inputVersion.sourceFiles ?? []).map(item => item.path);
const inputIntegrity = {};
for (const relative of inputFiles) {
  const file = path.join(inputDir, relative);
  assert(fs.existsSync(file), "冻结输入文件缺失", relative);
  const actual = sha256File(file);
  const expected = inputVersion.sourceFiles.find(item => item.path === relative)?.sha256;
  if (expected) assert(actual === expected, "冻结输入文件字节已漂移", { relative, expected, actual });
  inputIntegrity[relative] = { actual, expected: expected ?? null, byteSize: fs.statSync(file).size };
}

const heroIdByKey = {
  champion_evelynn: "Evelynn",
  champion_lillia: "Lillia",
  champion_fiddlesticks: "Fiddlesticks",
  champion_singed: "Singed",
};
const order = [
  "evelynn_p", "evelynn_q", "evelynn_w", "evelynn_e", "evelynn_r",
  "lillia_p", "lillia_q", "lillia_w", "lillia_e", "lillia_r",
  "fiddlesticks_p", "fiddlesticks_q", "fiddlesticks_w", "fiddlesticks_e", "fiddlesticks_r",
  "singed_p", "singed_q", "singed_w", "singed_e", "singed_r",
];
assert(JSON.stringify(inputVersion.skills) === JSON.stringify(order), "输入技能顺序或范围不符", inputVersion.skills);
const slotOf = key => key.slice(-1).toUpperCase();
const heroKeyOf = key => `champion_${key.split("_")[0]}`;
const sourceHeroOf = key => source.heroes.find(hero => hero.key === heroKeyOf(key));
const sourceSkillOf = key => sourceHeroOf(key)?.skills.find(skill => skill.skillKey === key);
const sourceSummaryOf = key => sourceHeroOf(key)?.source.skills.find(skill => skill.slot === slotOf(key));
const spellOf = key => sourceSkillOf(key)?.object?.mSpell;
const snapshotByRoute = new Map((protection.requests ?? []).map(item => [item.route, item]));
const officialSpellIndex = { Q: 0, W: 1, E: 2, R: 3 };
const officialOf = (heroId, slot, language = "官方中文") => {
  const d = readJson(path.join(inputDir, "参考资料", language, `${heroId}.json`)).data[heroId];
  return slot === "P" ? d.passive : d.spells[officialSpellIndex[slot]];
};

for (const key of order) {
  assert(sourceHeroOf(key) && sourceSkillOf(key) && sourceSummaryOf(key) && spellOf(key), "来源技能绑定缺失", key);
  assert(sourceSummaryOf(key).bindingAvailable === true, "技能绑定不可用", key);
}

const categories = snapshotByRoute.get("/skill-categories")?.data?.items ?? [];
const categoryKeys = new Set(categories.filter(item => item.status === "ENABLED").map(item => item.skillCategoryKey));
assert(categoryKeys.has("passive") && categoryKeys.has("common"), "技能分类字典缺少已有分类", categories);
const attributes = snapshotByRoute.get("/attributes")?.data?.items ?? [];
const attributeKeys = new Set(attributes.filter(item => item.status === "ENABLED").map(item => item.attributeKey));
for (const key of ["ability_power", "hp"]) assert(attributeKeys.has(key), "属性字典缺少候选需要的键", key);

const selectedTrace = Object.fromEntries(order.map(key => [key, {}]));
function dataRow(skillKey, name) {
  const row = (spellOf(skillKey)?.DataValues ?? []).find(item => item.name === name);
  assert(row, "DataValues字段缺失", { skillKey, name });
  return row;
}
function selected(skillKey, name, start, expected) {
  const values = dataRow(skillKey, name).values;
  assert(Array.isArray(values), "DataValues没有数组", { skillKey, name });
  const actual = expected.map((_, i) => values[start + i]);
  assert(actual.length === expected.length && actual.every(value => typeof value === "number" && Number.isFinite(value)), "DataValues等级值缺失", { skillKey, name, start, actual });
  assert(actual.every((value, i) => close(value, expected[i])), "DataValues索引或数值不符", { skillKey, name, start, actual, expected });
  const normalized = actual.map(clean);
  selectedTrace[skillKey][name] = { sourceDataIndices: actual.map((_, i) => start + i), sourceValues: actual, normalizedValues: normalized };
  return normalized;
}
function scalar(skillKey, name, start, expected) { return selected(skillKey, name, start, [expected])[0]; }
function calc(skillKey, name) {
  const value = spellOf(skillKey)?.mSpellCalculations?.[name];
  assert(value, "计算树缺失", { skillKey, name });
  return value;
}
function treeNumbers(skillKey, name) {
  const result = [];
  const walk = value => {
    if (typeof value === "number" && Number.isFinite(value)) result.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(calc(skillKey, name));
  return result;
}
function coefficient(skillKey, name, expected) {
  const values = treeNumbers(skillKey, name);
  assert(values.some(value => close(value, expected)), "计算树系数不符", { skillKey, name, expected, values });
  return clean(expected);
}
function multiplier(skillKey, name, expected) {
  const c = calc(skillKey, name);
  assert(c.mMultiplier && typeof c.mMultiplier.mNumber === "number" && close(c.mMultiplier.mNumber, expected), "计算树根乘数不符", { skillKey, name, expected, actual: c.mMultiplier });
  return clean(expected);
}
function ms(sec) {
  assert(typeof sec === "number" && Number.isFinite(sec), "秒值缺失", sec);
  assert(close(sec * 1000, Math.round(sec * 1000)), "秒转毫秒不是整数", sec);
  return Math.round(sec * 1000);
}
function spellCastMs(skillKey) { return ms(spellOf(skillKey)?.spellCastTime); }
function spellCastSeconds(skillKey, expected) {
  const value = spellOf(skillKey)?.spellCastTime;
  assert(typeof value === "number" && close(value, expected), "spellCastTime不符", { skillKey, expected, value });
  return clean(expected);
}
function directParam(parameterKey, name, valueType, valueMode, fixedValue, levelValues, description, sortOrder) {
  return { parameterKey, name, valueType, valueMode, fixedValue: fixedValue ?? null, levelValues: levelValues ? Object.fromEntries(levelValues.map((v, i) => [String(i + 1), clean(v)])) : null, description, sortOrder };
}
const fixed = (key, name, type, value, description, sortOrder) => directParam(key, name, type, "FIXED", clean(value), null, description, sortOrder);
const levels = (key, name, type, values, description, sortOrder) => directParam(key, name, type, "SKILL_LEVEL", null, values, description, sortOrder);
const runtime = (key, name, type, description, sortOrder) => directParam(key, name, type, "RUNTIME_INPUT", null, null, description, sortOrder);
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const add = (a, b) => O("ADD", a, b);
const mul = (a, b) => O("MULTIPLY", a, b);
const max = (a, b) => O("MAX", a, b);
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const ap = A("SOURCE", "ability_power", "TOTAL");
const targetHp = A("TARGET", "hp", "TOTAL");
const targetCurrentHp = A("TARGET", "hp", "CURRENT");
const valueRule = (kind, key) => ({ value: kind === "PARAMETER" ? { kind, parameterKey: key } : { kind, formulaKey: key }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const noEffects = [];

const writes = {}; const pending = {}; const excluded = {}; const proofs = {};
const put = (skillKey, parameters, formulas, pendingItems, excludedItems, proof) => {
  writes[skillKey] = { parameters, formulas, effects: [], processes: [], internalStates: [], triggerRules: [] };
  pending[skillKey] = pendingItems; excluded[skillKey] = excludedItems; proofs[skillKey] = proof;
};
const dataLevels = (skillKey, dataName, start, expected, key, name, type, description, sortOrder, transform = value => value) => levels(key, name, type, selected(skillKey, dataName, start, expected).map(transform), description, sortOrder);
const dataFixed = (skillKey, dataName, start, expected, key, name, type, description, sortOrder, transform = value => value) => fixed(key, name, type, transform(scalar(skillKey, dataName, start, expected)), description, sortOrder);
const calcFixed = (skillKey, calcName, expected, key, name, type, description, sortOrder) => fixed(key, name, type, coefficient(skillKey, calcName, expected), description, sortOrder);

// 伊芙琳 P：阈值树保留实际等级外供，治疗每秒插值也不猜完整求值。
{
  const threshold = calc("evelynn_p", "HealingThresholdTOOLTIP");
  assert(close(threshold.mFormulaParts?.find(p => p.__type === "ByCharLevelBreakpointsCalculationPart")?.mLevel1Value, 250), "伊芙琳P阈值起点不符");
  assert(close(threshold.mFormulaParts?.find(p => p.__type === "ByCharLevelBreakpointsCalculationPart")?.mInitialBonusPerLevel, 20), "伊芙琳P阈值每级增量不符");
  const heal = calc("evelynn_p", "HealPerSecondTOOLTIP");
  const interpolation = heal.mFormulaParts?.find(p => p.__type === "ByCharLevelInterpolationCalculationPart");
  assert(interpolation && close(interpolation.mStartValue, 15) && close(interpolation.mEndValue, 150), "伊芙琳P治疗插值端点不符");
  const thresholdAp = coefficient("evelynn_p", "HealingThresholdTOOLTIP", 2.5);
  put("evelynn_p", [
    dataFixed("evelynn_p", "DemonShadeTimer", 1, 4, "demon_shade_delay_ms", "进入恶魔魅影等待（毫秒）", "INTEGER", "客户端DemonShadeTimer为4秒，转换为4000毫秒。", 10, ms),
    dataFixed("evelynn_p", "StealthDropTimer", 1, 1.5, "stealth_drop_duration_ms", "受英雄或防御塔伤害后伪装移除（毫秒）", "INTEGER", "客户端StealthDropTimer为1.5秒，转换为1500毫秒。", 20, ms),
    fixed("stealth_start_level", "开始提供伪装的角色等级", "INTEGER", 6, "当前正文明确从6级开始提供伪装；不把伪装视作自主召唤。", 30),
    runtime("actual_healing_threshold_base", "当前角色等级实际治疗阈值基础值", "DECIMAL", "HealingThresholdTOOLTIP树给出角色等级1起250、每级加20，但本批没有完整等级求值算法；运行时必须提供当前等级实际基础值，不设默认。", 40),
    fixed("healing_threshold_ap_ratio", "治疗阈值法强比例", "DECIMAL", thresholdAp, "HealingThresholdTOOLTIP树的StatByCoefficient系数2.5；公式读取来源总法强。", 50),
    runtime("actual_heal_per_second", "当前角色等级实际每秒治疗值", "DECIMAL", "HealPerSecondTOOLTIP仅给角色等级插值端点15至150，未证完整求值；运行时必须提供实际值，不设默认。", 60),
  ], [formula("healing_threshold", "恶魔魅影治疗阈值", add(P("actual_healing_threshold_base"), mul(P("healing_threshold_ap_ratio"), ap)), "HealingThresholdTOOLTIP = 当前角色等级实际基础阈值 + 2.5×来源总法强；角色等级基础值不在此猜展开。", 10)], [
    { kind: "输入", item: "治疗阈值与每秒治疗角色等级求值", reason: "当前树只有断点起点/增量及插值端点，没有完整运行算法；保留无默认实际输入。" },
    { kind: "时序", item: "脱战回复、伤害移除和伪装资格", reason: "数值和正文明确，状态触发与实际应用时点未接线。" },
  ], [{ kind: "范围", item: "饰品/额外视野载体", reason: "本槽是自身恶魔魅影，未创建独立视野或召唤物效果。" }], "HealingThresholdTOOLTIP消费250起、每级20和2.5法强；HealPerSecondTOOLTIP仅保存15至150插值证据。" );
}

// 伊芙琳 Q：首发和至多三次重施共用当前MissileDamage的HateSpike树。
{
  const hateRatio = scalar("evelynn_q", "HateSpikeAPRatio", 1, 0.25);
  const bonusRatio = scalar("evelynn_q", "BonusDamageAPRatio", 1, 0.25);
  put("evelynn_q", [
    dataLevels("evelynn_q", "HateSpikeBaseDamage", 1, [25, 30, 35, 40, 45], "hate_spike_base_damage", "尖刺魔法伤害基础值", "INTEGER", "MissileDamage当前消费HateSpikeBaseDamage，技能等级取索引1至5；不误用MissileBaseDamage。", 10),
    fixed("hate_spike_ap_ratio", "尖刺法强比例", "DECIMAL", hateRatio, "MissileDamage树StatByNamedDataValue系数0.25；读取来源总法强。", 20),
    dataLevels("evelynn_q", "BonusDamageBase", 1, [15, 25, 35, 45, 55], "bonus_damage_base", "标记增伤基础值", "INTEGER", "TotalBonusDamage消费BonusDamageBase，技能等级取索引1至5。", 30),
    fixed("bonus_damage_ap_ratio", "标记增伤法强比例", "DECIMAL", bonusRatio, "TotalBonusDamage树StatByNamedDataValue系数0.25；读取来源总法强。", 40),
    dataFixed("evelynn_q", "QStackCount", 1, 3, "max_recasts", "最大重施次数", "INTEGER", "当前正文至多重施3次；不自动把三次伤害相加。", 50),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("evelynn_q"), "当前spellCastTime=0.25秒，转换为250毫秒。", 60),
  ], [
    formula("missile_magic_damage", "憎恨之刺尖刺魔法伤害", add(P("hate_spike_base_damage"), mul(P("hate_spike_ap_ratio"), ap)), "MissileDamage = HateSpikeBaseDamage + 0.25×来源总法强；首发与每次重施各自消费一次，重施数量由事件决定。", 10),
    formula("marked_bonus_magic_damage", "标记目标额外魔法伤害", add(P("bonus_damage_base"), mul(P("bonus_damage_ap_ratio"), ap)), "TotalBonusDamage = BonusDamageBase + 0.25×来源总法强；对标记目标的下3次攻击或技能分别消费，不把Q重施次数混入。", 20),
  ], [
    { kind: "时序", item: "首击标记、重施消耗与下三次增伤", reason: "当前正文给出首发、至多3次重施和下3次攻击/技能，具体事件顺序未接线。" },
  ], [{ kind: "范围", item: "尖刺命中的额外敌人", reason: "本轮一对一只保留单个敌方伤害载体，不把多目标数量乘入公式。" }], "MissileDamage严格绑定HateSpikeBaseDamage而非同槽MissileBaseDamage；TotalBonusDamage独立保存标记增伤。" );
}

// 伊芙琳 W：仅记录英雄标记的当前确定控制/减抗数值。
{
  put("evelynn_w", [
    fixed("mark_duration_ms", "标记持续时间（毫秒）", "INTEGER", 5000, "当前正文明确标记英雄或野怪5秒，转换为5000毫秒。", 10),
    dataFixed("evelynn_w", "SlowAmount", 1, 0.45, "early_slow_ratio", "提前抹除减速比例", "DECIMAL", "当前SlowAmount约0.45；正文按×100显示45%，保存比例0.45。", 20),
    dataFixed("evelynn_w", "SlowDuration", 1, 0.75, "early_slow_duration_ms", "提前抹除减速持续（毫秒）", "INTEGER", "当前SlowDuration=0.75秒，转换为750毫秒；不使用未消费NonCharmSlowDuration。", 30, ms),
    dataLevels("evelynn_w", "CharmDuration", 1, [1.25, 1.5, 1.75, 2, 2.25], "charm_duration_ms", "英雄魅惑持续（毫秒）", "INTEGER", "满2.5秒标记对英雄的CharmDuration取索引1至5，秒转毫秒。", 40, ms),
    dataLevels("evelynn_w", "MRShred", 1, [0.35, 0.375, 0.4, 0.425, 0.45], "mr_shred_ratio", "英雄魔抗削减比例", "DECIMAL", "满标记对英雄的MRShred取索引1至5；正文按×100显示35%至45%，保存比例。", 50),
    dataFixed("evelynn_w", "ShredDuration", 1, 4, "mr_shred_duration_ms", "魔抗削减持续（毫秒）", "INTEGER", "当前ShredDuration=4秒，转换为4000毫秒。", 60, ms),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("evelynn_w"), "当前spellCastTime=0.25秒，转换为250毫秒。", 70),
  ], [], [
    { kind: "时序", item: "标记蓄满、命中抹除与返还法力", reason: "满2.5秒才获得英雄魅惑和减抗；返还及命中时点未接线。" },
    { kind: "目标资格", item: "英雄目标施加顺序", reason: "英雄/野怪分支及伤害前后顺序另核，本轮只保留英雄确定数值。" },
  ], [{ kind: "范围", item: "野怪魅惑和野怪伤害", reason: "本轮唯一敌方英雄范围排除野怪专用MonsterCharm、MonsterDamage分支。" }], "保留正文明确的5秒标记、提前抹除45%减速0.75秒和满标记英雄魅惑/魔抗削减；W不退出恶魔魅影另列语义。" );
}

// 伊芙琳 E：普通与强化互斥，各自保存完整伤害树。
{
  const baseAp = coefficient("evelynn_e", "PercentHealthBaseTOOLTIP", 0.015);
  const empoweredAp = coefficient("evelynn_e", "PercentHealthEmpoweredTOOLTIP", 0.025);
  const percentRoot = multiplier("evelynn_e", "PercentHealthBaseTOOLTIP", 0.01);
  assert(close(calc("evelynn_e", "PercentHealthEmpoweredTOOLTIP").mMultiplier?.mNumber, 0.01), "伊芙琳E强化百分比根乘数不符");
  put("evelynn_e", [
    dataLevels("evelynn_e", "BaseDamage", 1, [60, 90, 120, 150, 180], "base_damage", "普通鞭笞基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5；普通E分支。", 10),
    dataLevels("evelynn_e", "EmpoweredDamage", 1, [80, 120, 160, 200, 240], "empowered_damage", "强化鞭笞基础魔法伤害", "INTEGER", "客户端EmpoweredDamage取索引1至5；强化E分支与普通E互斥。", 20),
    dataFixed("evelynn_e", "BasePercentHealth", 1, 3, "base_percent_health_points", "普通E目标最大生命百分数点", "INTEGER", "普通PercentHealthBaseTOOLTIP使用BasePercentHealth=3；百分数点由0.01根乘数转为比例。", 30),
    dataFixed("evelynn_e", "EmpoweredPercentHealth", 1, 4, "empowered_percent_health_points", "强化E目标最大生命百分数点", "INTEGER", "强化PercentHealthEmpoweredTOOLTIP使用EmpoweredPercentHealth=4；百分数点由0.01根乘数转为比例。", 40),
    fixed("percent_points_to_ratio", "百分数点转比例", "DECIMAL", percentRoot, "PercentHealth两棵树根mMultiplier=0.01；完整伤害使用百分数点×0.01。", 50),
    fixed("base_percent_ap_ratio", "普通E生命百分比法强比例", "DECIMAL", baseAp, "普通PercentHealthBaseTOOLTIP树StatByCoefficient=0.015。", 60),
    fixed("empowered_percent_ap_ratio", "强化E生命百分比法强比例", "DECIMAL", empoweredAp, "强化PercentHealthEmpoweredTOOLTIP树StatByCoefficient=0.025。", 70),
    dataLevels("evelynn_e", "SpeedAmount", 1, [0.3, 0.35, 0.4, 0.45, 0.5], "speed_bonus_ratio", "E后自身移动速度加成比例", "DECIMAL", "当前SpeedAmount取索引1至5，正文按×100显示30%至50%。", 80),
    dataFixed("evelynn_e", "SpeedDuration", 1, 2, "speed_duration_ms", "E后移动速度持续（毫秒）", "INTEGER", "当前SpeedDuration=2秒，转换为2000毫秒。", 90, ms),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("evelynn_e"), "当前spellCastTime=0.25秒，转换为250毫秒。", 100),
  ], [
    formula("ordinary_magic_damage", "普通鞭笞魔法伤害", add(P("base_damage"), mul(mul(P("percent_points_to_ratio"), add(P("base_percent_health_points"), mul(P("base_percent_ap_ratio"), ap))), targetHp)), "普通E = 基础伤害 + 0.01×(3 + 0.015×来源总法强)×目标最大生命；与强化E互斥。", 10),
    formula("empowered_magic_damage", "强化鞭笞魔法伤害", add(P("empowered_damage"), mul(mul(P("percent_points_to_ratio"), add(P("empowered_percent_health_points"), mul(P("empowered_percent_ap_ratio"), ap))), targetHp)), "强化E = 基础伤害 + 0.01×(4 + 0.025×来源总法强)×目标最大生命；由恶魔魅影强化时使用，不能与普通E相加。", 20),
  ], [
    { kind: "状态", item: "恶魔魅影刷新冷却和强化资格", reason: "正文给出进入恶魔魅影会刷新并强化E；本候选保存两条互斥数值树，不自动创建跨技能事件。" },
  ], [{ kind: "范围", item: "沿途额外目标和野怪封顶", reason: "本轮一对一英雄范围排除额外目标及野怪封顶分支。" }], "普通/强化E分别取当前两棵百分比树，0.01作用于百分数点与法强项整体；SpeedAmount单独保留。" );
}

// 伊芙琳 R：低于30%生命是完整伤害的2.4倍，不作为暴击。
{
  const apRatio = coefficient("evelynn_r", "Damage", 0.75);
  const lowMultiplier = scalar("evelynn_r", "CritMultiplier", 1, 2.4);
  put("evelynn_r", [
    dataLevels("evelynn_r", "BaseDamage", 1, [125, 250, 375], "base_damage", "最终抚慰基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至3；当前Damage树基础项。", 10),
    fixed("ap_ratio", "法强比例", "DECIMAL", apRatio, "Damage树StatByCoefficient=0.75；读取来源总法强。", 20),
    dataFixed("evelynn_r", "CritTreshold", 1, 0.3, "low_health_threshold", "低生命增伤阈值", "DECIMAL", "客户端CritTreshold约0.3；正文为目标低于30%生命时进入增伤分支。", 30),
    dataFixed("evelynn_r", "CritMultiplier", 1, lowMultiplier, "low_health_multiplier", "低生命完整伤害倍率", "DECIMAL", "CritDamage树根mMultiplier=2.4；这里是低生命增伤，不是暴击几率或普通暴击。", 40),
    dataFixed("evelynn_r", "PassiveReset", 1, 1.25, "passive_reset_ms", "施放后被动刷新延迟（毫秒）", "INTEGER", "客户端PassiveReset=1.25秒，转换为1250毫秒；事件未接线。", 50, ms),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("evelynn_r"), "当前spellCastTime=0.25秒，转换为250毫秒。", 60),
  ], [
    formula("normal_magic_damage", "最终抚慰普通魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "Damage = 基础伤害 + 0.75×来源总法强。", 10),
    formula("low_health_magic_damage", "最终抚慰低生命魔法伤害", mul(P("low_health_multiplier"), add(P("base_damage"), mul(P("ap_ratio"), ap))), "CritDamage = 2.4×完整Damage；仅目标低于30%生命时使用，名称不表示暴击。", 20),
  ], [
    { kind: "时序", item: "低生命判断、不可选取和后退位移", reason: "正文明确低于30%分支和施放后被动刷新；不可选取持续时间与实际事件未给，不编造。" },
  ], [{ kind: "范围", item: "区域内额外敌人分配", reason: "本轮唯一敌方英雄只保留单目标载体，不把范围目标数乘入。" }], "R的2.4是CritDamage树低血根乘数；候选改用低生命增伤命名，避免误作暴击。" );
}

// 莉莉娅 P：总伤害比例只乘一次；英雄治疗区分每跳与六跳总量。
{
  const dotAp = coefficient("lillia_p", "DotPercentTotal", 0.0125);
  const dotRoot = multiplier("lillia_p", "DotPercentTooltip", 0.01);
  const healAp = coefficient("lillia_p", "ChampionHeal", 0.05);
  const heal = calc("lillia_p", "ChampionHeal").mFormulaParts?.find(p => p.__type === "ByCharLevelInterpolationCalculationPart");
  assert(heal && close(heal.mStartValue, 1) && close(heal.mEndValue, 15) && heal.mScaleByStatProgressionMultiplier === true, "莉莉娅P英雄治疗插值不符", heal);
  const ticks = dataFixed("lillia_p", "DotTicks", 1, 6, "dot_ticks", "梦尘伤害跳数", "INTEGER", "当前DotTicks=6；总比例只应用一次，跳数用于治疗总量与来源时序说明。", 50);
  put("lillia_p", [
    dataFixed("lillia_p", "Duration", 1, 3, "dot_duration_ms", "梦尘持续时间（毫秒）", "INTEGER", "当前Duration=3秒，转换为3000毫秒。", 10, ms),
    dataFixed("lillia_p", "DotDamagePercent", 1, 5, "dot_damage_percent_points", "梦尘最大生命百分数点", "INTEGER", "DotPercentTotal使用DotDamagePercent=5；DotPercentTooltip根0.01再转为比例。", 20),
    fixed("percent_points_to_ratio", "百分数点转比例", "DECIMAL", dotRoot, "DotPercentTooltip树根mMultiplier=0.01；作用于完整的5+0.0125×法强。", 30),
    fixed("dot_ap_ratio", "梦尘法强比例", "DECIMAL", dotAp, "DotPercentTotal树StatByCoefficient=0.0125；读取来源总法强。", 40),
    ticks,
    runtime("actual_champion_heal_base", "当前角色等级每跳英雄治疗基础值", "DECIMAL", "ChampionHeal树给出角色等级插值1至15且启用角色成长倍率；完整求值算法未证，运行时必须提供实际每跳基础值，不设默认。", 60),
    fixed("champion_heal_ap_ratio", "英雄治疗法强比例", "DECIMAL", healAp, "ChampionHeal树StatByCoefficient=0.05；读取来源总法强。", 70),
  ], [
    formula("dot_total_magic_damage", "梦尘总魔法伤害", mul(mul(P("percent_points_to_ratio"), add(P("dot_damage_percent_points"), mul(P("dot_ap_ratio"), ap))), targetHp), "DotPercentTooltip = 0.01×(5 + 0.0125×来源总法强)×目标最大生命；3秒内6跳但总比例不逐跳重复。", 10),
    formula("champion_heal_per_tick", "对英雄每跳治疗量", add(P("actual_champion_heal_base"), mul(P("champion_heal_ap_ratio"), ap)), "ChampionHeal = 当前角色等级实际基础值 + 0.05×来源总法强；算法由运行时提供实际基础值。", 20),
    formula("champion_heal_total", "对英雄六跳总治疗量", mul(P("dot_ticks"), add(P("actual_champion_heal_base"), mul(P("champion_heal_ap_ratio"), ap))), "ChampionHealTT = DotTicks×每跳治疗；只表示六跳总量，不改变梦尘伤害比例。", 30),
  ], [
    { kind: "输入", item: "角色等级治疗曲线", reason: "客户端只有1至15插值端点且带成长倍率，未证完整角色等级求值；使用无默认实际输入。" },
    { kind: "时序", item: "首跳、刷新和梦尘来源分配", reason: "跳数和持续时间有来源，首跳时点及刷新细节未接线。" },
  ], [{ kind: "范围", item: "野怪治疗、封顶和额外来源效能", reason: "本轮唯一敌方英雄排除野怪专用分支及额外来源15%效能分配。" }], "DotPercentTooltip的0.01只作用完整百分比树一次；ChampionHeal/ChampionHealTT按每跳与6跳分别记录。" );
}

// 莉莉娅 Q：内圈魔法与外圈额外真实伤害分开，层数是整数并有上限。
{
  const apRatio = scalar("lillia_q", "APRatio", 1, 0.35);
  const speedAp = coefficient("lillia_q", "PranceSpeed", 0.0003);
  put("lillia_q", [
    dataLevels("lillia_q", "FlatDamageBase", 1, [35, 45, 55, 65, 75], "inner_damage_base", "内圈魔法伤害基础值", "INTEGER", "TotalDamage取FlatDamageBase索引1至5。", 10),
    dataLevels("lillia_q", "FlatDamageTrue", 1, [35, 45, 55, 65, 75], "outer_true_damage_base", "外圈额外真实伤害基础值", "INTEGER", "BonusTrueDamage取FlatDamageTrue索引1至5，与内圈魔法伤害分开。", 20),
    fixed("ap_ratio", "伤害法强比例", "DECIMAL", apRatio, "TotalDamage与BonusTrueDamage均消费0.35×来源总法强。", 30),
    dataLevels("lillia_q", "PranceBonusPerStack", 1, [0.03, 0.04, 0.05, 0.06, 0.07], "prance_bonus_ratio_per_stack", "每层移速加成比例", "DECIMAL", "PranceBonusPerStack取索引1至5；正文显示3%至7%。", 40),
    fixed("prance_ap_ratio", "每层移速法强系数", "DECIMAL", speedAp, "PranceSpeed树StatByCoefficient=0.0003；读取来源总法强。", 50),
    dataFixed("lillia_q", "PranceDuration", 1, 6.5, "prance_duration_ms", "移速层持续时间（毫秒）", "INTEGER", "当前PranceDuration=6.5秒，转换为6500毫秒。", 60, ms),
    dataFixed("lillia_q", "PranceMaxStacks", 1, 4, "prance_max_stacks", "移速最大层数", "INTEGER", "当前PranceMaxStacks=4；运行时层数必须为整数且不超过4。", 70),
    dataFixed("lillia_q", "PranceFalloffTime", 1, 1, "prance_falloff_ms", "移速层衰减间隔（毫秒）", "INTEGER", "当前PranceFalloffTime=1秒，转换为1000毫秒。", 80, ms),
    dataFixed("lillia_q", "MinimumRadius", 1, 225, "inner_radius", "内圈半径", "INTEGER", "当前MinimumRadius=225；仅保留几何边界。", 90),
    dataFixed("lillia_q", "MaximumRadius", 1, 485, "outer_radius", "外圈半径", "INTEGER", "当前MaximumRadius=485；外圈额外真实伤害仍按单个目标一次记录。", 100),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("lillia_q"), "当前spellCastTime=0，保留为0毫秒。", 110),
  ], [
    formula("inner_magic_damage", "飞花挞内圈魔法伤害", add(P("inner_damage_base"), mul(P("ap_ratio"), ap)), "TotalDamage = 内圈基础伤害 + 0.35×来源总法强。", 10),
    formula("outer_true_damage", "飞花挞外圈额外真实伤害", add(P("outer_true_damage_base"), mul(P("ap_ratio"), ap)), "BonusTrueDamage = 外圈额外真实伤害基础值 + 0.35×来源总法强；与内圈魔法伤害分开。", 20),
    formula("move_speed_per_stack", "飞花挞每层移速加成", add(P("prance_bonus_ratio_per_stack"), mul(P("prance_ap_ratio"), ap)), "PranceSpeed = 每层来源比例 + 0.0003×来源总法强；层数由上限4的事件输入控制。", 30),
  ], [
    { kind: "输入", item: "当前移速层数", reason: "本轮只保存层数上限和每层公式；实际层数是运行时整数输入，不设默认、不自动乘满。" },
    { kind: "时序", item: "命中、层刷新和衰减", reason: "持续时间、衰减间隔和上限有来源，具体刷新顺序未接线。" },
  ], [{ kind: "范围", item: "多名敌人伤害分配", reason: "唯一敌方范围不把外圈可命中目标数量乘入单目标公式。" }], "内圈魔法与外圈额外真实树分开；PranceSpeed保留整数层数上限、持续与衰减。" );
}

// 莉莉娅 W：中心值是普通伤害的完整三倍替代值。
{
  const apRatio = coefficient("lillia_w", "FlatDamage", 0.35);
  const sweetMultiplier = scalar("lillia_w", "SweetSpotBonus", 1, 3);
  put("lillia_w", [
    dataLevels("lillia_w", "FlatDamageBase", 1, [80, 100, 120, 140, 160], "base_damage", "惊惶木基础魔法伤害", "INTEGER", "FlatDamageBase取索引1至5；索引0的60不是技能等级1。", 10),
    fixed("ap_ratio", "法强比例", "DECIMAL", apRatio, "FlatDamage树StatByCoefficient=0.35；读取来源总法强。", 20),
    dataFixed("lillia_w", "SweetSpotBonus", 1, sweetMultiplier, "sweet_spot_multiplier", "中心伤害倍率", "INTEGER", "FlatDamageSweetSpot根mMultiplier=3；中心值替代普通命中值，不与普通值相加。", 30),
    dataFixed("lillia_w", "MinimumCastTime", 1, 0.6, "minimum_cast_time_ms", "最短准备时间（毫秒）", "INTEGER", "当前MinimumCastTime=0.6秒，转换为600毫秒。", 40, ms),
    dataFixed("lillia_w", "MaximumCastTime", 1, 0.75, "maximum_cast_time_ms", "最长准备时间（毫秒）", "INTEGER", "当前MaximumCastTime=0.75秒，转换为750毫秒。", 50, ms),
    dataFixed("lillia_w", "MinimumRadius", 1, 250, "minimum_radius", "技能区域半径", "INTEGER", "当前MinimumRadius=250；只记录几何边界。", 60),
    dataFixed("lillia_w", "SweetSpotRadius", 1, 65, "sweet_spot_radius", "中心命中半径", "INTEGER", "当前SweetSpotRadius=65；中心伤害资格仍由命中位置决定。", 70),
  ], [
    formula("magic_damage", "惊惶木普通魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "FlatDamage = 基础伤害 + 0.35×来源总法强。", 10),
    formula("sweet_spot_magic_damage", "惊惶木中心魔法伤害", mul(P("sweet_spot_multiplier"), add(P("base_damage"), mul(P("ap_ratio"), ap))), "FlatDamageSweetSpot = 3×普通完整值；中心命中替代普通结果。", 20),
  ], [
    { kind: "时序", item: "蓄力与中心命中判定", reason: "最短/最长准备时间有来源，几何求值和命中时点未接线。" },
  ], [{ kind: "范围", item: "小兵减伤", reason: "本轮唯一敌方英雄范围排除小兵50%分支。" }], "普通和中心W分别表达，中心为完整普通值×3，不重复累加。" );
}

// 莉莉娅 E：种子作为伤害载体，不把它当自主召唤物。
{
  const apRatio = scalar("lillia_e", "APRatio", 1, 0.5);
  put("lillia_e", [
    dataLevels("lillia_e", "ImpactDamage", 1, [60, 85, 110, 135, 160], "impact_damage_base", "流涡种基础魔法伤害", "INTEGER", "ImpactDamage取索引1至5；索引0的35不是技能等级1。", 10),
    fixed("ap_ratio", "法强比例", "DECIMAL", apRatio, "ImpactDamageTotal树StatByCoefficient=0.5；读取来源总法强。", 20),
    dataFixed("lillia_e", "SlowAmount", 1, 0.4, "slow_ratio", "流涡种减速比例", "DECIMAL", "当前SlowAmount=0.4，正文显示40%。", 30),
    dataFixed("lillia_e", "SlowDuration", 1, 3, "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "当前SlowDuration=3秒，转换为3000毫秒。", 40, ms),
    dataFixed("lillia_e", "ImpactRangeCheck", 1, 115, "impact_range_check", "命中范围判定", "INTEGER", "当前ImpactRangeCheck=115；只保存当前命中边界。", 50),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("lillia_e"), "当前spellCastTime约0.35秒，转换为350毫秒。", 60),
  ], [formula("impact_magic_damage", "流涡种命中魔法伤害", add(P("impact_damage_base"), mul(P("ap_ratio"), ap)), "ImpactDamageTotal = 基础伤害 + 0.5×来源总法强；种子是伤害载体。", 10)], [
    { kind: "时序", item: "滚动、撞墙和命中时点", reason: "当前正文说明未命中会继续滚动；事件链和远端命中时点未接线。" },
  ], [{ kind: "范围", item: "纯显形及远处额外目标", reason: "本轮只保留唯一敌人命中载体，不创建自主召唤或远处多目标结果。" }], "ImpactDamageTotal取当前ImpactDamage索引1至5和0.5法强；种子不是独立自主召唤物。" );
}

// 莉莉娅 R：非周期性伤害唤醒时才消费额外伤害。
{
  const apRatio = coefficient("lillia_r", "TotalDamage", 0.4);
  put("lillia_r", [
    dataFixed("lillia_r", "DrowsyDuration", 1, 1.5, "drowsy_duration_ms", "困倦持续时间（毫秒）", "INTEGER", "当前DrowsyDuration=1.5秒，转换为1500毫秒。", 10, ms),
    dataFixed("lillia_r", "SleepDuration", 1, 2, "sleep_duration_ms", "昏睡持续时间（毫秒）", "INTEGER", "当前SleepDuration=2秒，转换为2000毫秒。", 20, ms),
    dataLevels("lillia_r", "BreakDamageBase", 1, [100, 150, 200], "break_damage_base", "唤醒基础魔法伤害", "INTEGER", "TotalDamage当前使用BreakDamageBase索引1至3；ImpactDamage=25未进入当前唤醒树。", 30),
    fixed("ap_ratio", "法强比例", "DECIMAL", apRatio, "TotalDamage树StatByCoefficient=0.4；读取来源总法强。", 40),
    dataFixed("lillia_r", "InitialSlow", 1, -0.1, "initial_slow_ratio", "困倦初始减速比例", "DECIMAL", "客户端InitialSlow为-0.1；只记录初始值，空SlowIncrement不推导完整曲线。", 50, value => -value),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("lillia_r"), "当前spellCastTime=0.25秒，转换为250毫秒。", 60),
  ], [formula("break_magic_damage", "梦魇之尘唤醒魔法伤害", add(P("break_damage_base"), mul(P("ap_ratio"), ap)), "仅非周期性伤害打醒时消费：BreakDamageBase + 0.4×来源总法强；自然睡醒不自动补伤。", 10)], [
    { kind: "时序", item: "梦尘前置、困倦、昏睡与唤醒", reason: "当前正文给出1.5秒困倦和2秒昏睡；非周期性伤害唤醒条件未接事件。" },
    { kind: "输入", item: "SlowIncrement完整曲线", reason: "当前SlowIncrement节点无值，不能把初始-0.1扩成等级曲线。" },
  ], [{ kind: "范围", item: "周期性梦尘自动唤醒", reason: "本轮明确持续梦尘伤害不自动打醒，不能把P周期伤害接成R唤醒事件。" }], "R只录当前BreakDamageBase树和困倦/昏睡时长；未消费ImpactDamage25和空SlowIncrement不进入公式。" );
}

// 费德提克 P：排除自主草间人，但保留本体静止2秒的Q恐惧资格。
{
  put("fiddlesticks_p", [
    fixed("self_stationary_duration_ms", "本体冒充草间人所需静止（毫秒）", "INTEGER", 2000, "当前正文明确本体2秒内没有移动即可冒充草间人；这是Q被动资格，不是自主召唤物。", 10),
  ], [], [
    { kind: "资格", item: "本体静止后Q被动恐惧", reason: "本体冒充草间人是Q被动明确路径，资格事件仍待接线。" },
  ], [{ kind: "范围", item: "饰品草间人自主替身与视野", reason: "本轮排除自主召唤/视野载体，但不删除本体静止资格。" }], "只保留自身2秒静止条件；饰品草间人不是本轮直接机制组成。" );
}

// 费德提克 Q：用目标当前生命，普通和近期恐惧双倍分支互斥。
{
  const apRatio = coefficient("fiddlesticks_q", "TotalPercentHealthDamage", 0.0003);
  const fearedMultiplier = multiplier("fiddlesticks_q", "TotalPercentHealthDamageFeared", 2);
  put("fiddlesticks_q", [
    dataLevels("fiddlesticks_q", "MaxHealthDamage", 1, [0.04, 0.045, 0.05, 0.055, 0.06], "current_health_ratio", "目标当前生命比例", "DECIMAL", "当前树虽名为MaxHealthDamage，正文明确读取目标当前生命；取索引1至5并保存为比例。", 10),
    fixed("current_health_ap_ratio", "当前生命法强系数", "DECIMAL", apRatio, "TotalPercentHealthDamage树StatByCoefficient=0.0003；读取来源总法强。", 20),
    dataLevels("fiddlesticks_q", "MinimumDamage", 1, [40, 60, 80, 100, 120], "minimum_damage", "恐惧最小魔法伤害", "INTEGER", "当前MinimumDamage取索引1至5；近期恐惧分支最小值同样乘2。", 30),
    dataLevels("fiddlesticks_q", "FearDuration", 1, [1.2, 1.4, 1.6, 1.8, 2], "fear_duration_ms", "恐惧持续时间（毫秒）", "INTEGER", "当前FearDuration取索引1至5，秒转毫秒。", 40, ms),
    fixed("recent_fear_multiplier", "近期恐惧伤害倍率", "INTEGER", fearedMultiplier, "TotalPercentHealthDamageFeared根mMultiplier=2；与普通分支互斥。", 50),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("fiddlesticks_q"), "当前spellCastTime约0.35秒，转换为350毫秒。", 60),
  ], [
    formula("normal_magic_damage", "恐惧普通魔法伤害", max(P("minimum_damage"), mul(targetCurrentHp, add(P("current_health_ratio"), mul(P("current_health_ap_ratio"), ap)))), "普通完整值 = MAX(最小伤害, 目标当前生命×(当前生命比例 + 0.0003×来源总法强))；不把MaxHealthDamage当最大生命。", 10),
    formula("feared_magic_damage", "恐惧近期目标双倍魔法伤害", mul(P("recent_fear_multiplier"), max(P("minimum_damage"), mul(targetCurrentHp, add(P("current_health_ratio"), mul(P("current_health_ap_ratio"), ap))))), "近期已被费德提克恐惧的目标使用普通完整值×2，最小伤害也翻倍；近期窗口不在此猜。", 20),
  ], [
    { kind: "时序", item: "近期恐惧窗口", reason: "当前正文只写近期，不给具体时间；保留双倍参数，不伪造窗口。" },
    { kind: "资格", item: "非战斗/未被看见或冒充草间人", reason: "当前文本给出Q被动恐惧资格，资格判定事件未接线。" },
  ], [{ kind: "范围", item: "小兵和野怪400伤害上限", reason: "本轮唯一敌方英雄排除兵野专用封顶。" }], "Q严格使用TARGET.hp.CURRENT；MAX包住普通完整值，近期恐惧分支整体乘2。" );
}

// 费德提克 W：引导每秒伤害、结尾已损生命和英雄折前治疗分别建模。
{
  const apRatio = coefficient("fiddlesticks_w", "DrainDamageCalc", 0.45);
  put("fiddlesticks_w", [
    dataLevels("fiddlesticks_w", "DamagePerSecond", 1, [60, 90, 120, 150, 180], "damage_per_second_base", "每秒基础魔法伤害", "INTEGER", "DrainDamageCalc消费DamagePerSecond索引1至5。", 10),
    fixed("ap_ratio", "每秒伤害法强比例", "DECIMAL", apRatio, "DrainDamageCalc树StatByCoefficient=0.45；读取来源总法强。", 20),
    dataFixed("fiddlesticks_w", "TicksPerSecond", 1, 4, "ticks_per_second", "每秒跳数", "INTEGER", "当前TicksPerSecond=4；只记录源时序参数，不创建未经证明的周期过程。", 30),
    dataFixed("fiddlesticks_w", "DrainDuration", 1, 2, "drain_duration_ms", "引导持续时间（毫秒）", "INTEGER", "当前DrainDuration=2秒，转换为2000毫秒。", 40, ms),
    dataLevels("fiddlesticks_w", "PercentForTooltip", 1, [12, 14.5, 17, 19.5, 22], "end_missing_health_percent_points", "结束时已损生命百分数点", "DECIMAL", "当前正文结尾消费PercentForTooltip，取索引1至5；运行时已损生命输入必须是结尾阶段实际值。", 50),
    dataLevels("fiddlesticks_w", "VampPercentage", 1, [25, 32.5, 40, 47.5, 55], "champion_heal_percent_points", "英雄折前伤害治疗百分数点", "DECIMAL", "英雄治疗消费VampPercentage，取索引1至5；正文明确基于折前伤害。", 60),
    fixed("percent_points_to_ratio", "百分数点转比例", "DECIMAL", 0.01, "PercentForTooltip和VampPercentage均以百分数点显示，公式统一乘0.01转为比例。", 70),
    fixed("cooldown_refund_ratio", "完整引导冷却返还比例", "DECIMAL", 0.6, "当前正文明确未被打断结束引导时剩余冷却缩短60%；事件未接线。", 80),
    runtime("actual_target_missing_health", "结尾阶段目标实际已损生命", "DECIMAL", "W结尾额外伤害读取当时已损生命；不能用施法前生命或默认值替代。", 90),
    runtime("actual_hero_pre_mitigation_damage", "当前合资格英雄折前伤害", "DECIMAL", "英雄治疗按当前合资格折前伤害计算；运行时必须提供实际折前值，不设默认。", 100),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("fiddlesticks_w"), "当前spellCastTime=0.25秒，转换为250毫秒。", 110),
  ], [
    formula("damage_per_second", "五骨丰登每秒魔法伤害", add(P("damage_per_second_base"), mul(P("ap_ratio"), ap)), "DrainDamageCalc = 每秒基础伤害 + 0.45×来源总法强；持续2秒和跳数由时序层解释。", 10),
    formula("end_missing_health_damage", "五骨丰登结尾已损生命魔法伤害", mul(P("percent_points_to_ratio"), mul(P("end_missing_health_percent_points"), P("actual_target_missing_health"))), "结尾额外伤害 = 0.01×PercentForTooltip百分数点×结尾阶段实际已损生命；不能用施法前生命或默认值替代。", 20),
    formula("champion_heal_amount", "五骨丰登英雄折前治疗量", mul(P("percent_points_to_ratio"), mul(P("champion_heal_percent_points"), P("actual_hero_pre_mitigation_damage"))), "英雄治疗 = 0.01×VampPercentage百分数点×当前合资格折前伤害；正文明确基于折前伤害。", 30),
  ], [
    { kind: "输入", item: "结尾已损生命和折前伤害", reason: "两者都是当前阶段运行输入，不能默认或互换。" },
    { kind: "时序", item: "四跳、被打断与60%返还", reason: "当前树给每秒伤害，正文给2秒/完成返还；未创建周期过程和引导事件。" },
  ], [{ kind: "范围", item: "兵野伤害/治疗专用倍率", reason: "本轮唯一敌方英雄排除Monster/Minion分支。" }], "W把每秒伤害、结尾已损生命额外伤害和英雄折前治疗拆开；运行输入无默认。" );
}

// 费德提克 E：当前普通减速取负值来源的正比例显示，中心沉默只记参数。
{
  const apRatio = coefficient("fiddlesticks_e", "Damage", 0.5);
  put("fiddlesticks_e", [
    dataLevels("fiddlesticks_e", "BaseDamage", 1, [70, 105, 140, 175, 210], "base_damage", "夜割基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5。", 10),
    fixed("ap_ratio", "法强比例", "DECIMAL", apRatio, "Damage树StatByCoefficient=0.5；读取来源总法强。", 20),
    dataLevels("fiddlesticks_e", "SlowAmount", 1, [-0.3, -0.35, -0.4, -0.45, -0.5], "slow_ratio", "夜割减速比例", "DECIMAL", "客户端SlowAmount原值为-0.30至-0.50，正文按负号×100显示正减速；保存正比例并记录转换。", 30, value => -value),
    dataFixed("fiddlesticks_e", "SilenceDuration", 1, 1.25, "silence_duration_ms", "中心沉默持续（毫秒）", "INTEGER", "当前SilenceDuration=1.25秒，转换为1250毫秒；中心资格未自动创建效果。", 40, ms),
    dataFixed("fiddlesticks_e", "CastRange", 1, 850, "cast_range", "施法距离", "INTEGER", "当前CastRange=850；只保存几何参数。", 50),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("fiddlesticks_e"), "当前spellCastTime=0.25秒，转换为250毫秒。", 60),
  ], [formula("magic_damage", "夜割魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "Damage = 基础伤害 + 0.5×来源总法强；减速和中心沉默为独立控制载体。", 10)], [
    { kind: "资格", item: "中心沉默命中判定", reason: "当前正文明确中心沉默，具体几何资格未接线。" },
  ], [{ kind: "范围", item: "EmpoweredSlowAmount强化减速", reason: "当前EmpoweredSlowAmount未被普通Damage/Slow正文消费，本轮不擅自录入。" }], "SlowAmount按当前负值来源转为正减速比例；不把未消费强化减速塞入普通公式。" );
}

// 费德提克 R：当前150/250/350每秒、5秒；匿名根树与单次0.25系数均保留。
{
  const apRatio = scalar("fiddlesticks_r", "APRatio", 1, 0.5);
  const singleMultiplier = multiplier("fiddlesticks_r", "DamageDone", 0.25);
  const total = calc("fiddlesticks_r", "TotalDamage");
  assert(total.mMultiplier?.mDataValue === "Duration" && total.mModifiedGameCalculation === "{d0d3db7f}", "费德提克R总量根树不符", total);
  put("fiddlesticks_r", [
    dataLevels("fiddlesticks_r", "DamagePerSecond", 1, [150, 250, 350], "damage_per_second_base", "群鸦每秒基础魔法伤害", "INTEGER", "当前DataValues.DamagePerSecond取索引1至3为150/250/350；不使用旧effect125/225/325。", 10),
    fixed("ap_ratio", "法强比例", "DECIMAL", apRatio, "当前匿名{d0d3db7f}树StatByNamedDataValue系数0.5；读取来源总法强。", 20),
    dataFixed("fiddlesticks_r", "Duration", 1, 5, "full_duration_seconds", "杀人鸦持续（秒）", "DECIMAL", "当前Duration=5秒；TotalDamage匿名树以秒为根乘数，保留原单位用于总量公式。", 30),
    dataFixed("fiddlesticks_r", "Duration", 1, 5, "full_duration_ms", "杀人鸦持续（毫秒）", "INTEGER", "当前Duration=5秒，转换为5000毫秒供时序记录。", 40, ms),
    dataFixed("fiddlesticks_r", "ChannelTime", 1, 1.5, "channel_time_ms", "引导时间（毫秒）", "INTEGER", "当前ChannelTime=1.5秒，转换为1500毫秒。", 50, ms),
    fixed("single_damage_multiplier", "单次伤害根倍率", "DECIMAL", singleMultiplier, "DamageDone树根mMultiplier=0.25；只表示当前单次伤害系数，不推定完整时序。", 60),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("fiddlesticks_r"), "当前spellCastTime=0，保留为0毫秒。", 70),
  ], [
    formula("damage_per_second", "群鸦每秒魔法伤害", add(P("damage_per_second_base"), mul(P("ap_ratio"), ap)), "匿名{d0d3db7f} = 每秒基础伤害 + 0.5×来源总法强；当前R持续5秒。", 10),
    formula("damage_done_single_tick", "群鸦当前单次伤害系数值", mul(P("single_damage_multiplier"), add(P("damage_per_second_base"), mul(P("ap_ratio"), ap))), "DamageDone = 0.25×当前匿名每秒伤害树；0.25是源树单次系数，不把每秒次数或总时序强行推导。", 20),
    formula("total_magic_damage", "群鸦五秒总魔法伤害", mul(P("full_duration_seconds"), add(P("damage_per_second_base"), mul(P("ap_ratio"), ap))), "TotalDamage = Duration(5秒)×匿名每秒伤害树；持续5秒，不采用旧官方effect值。", 30),
  ], [
    { kind: "时序", item: "引导、传送、每秒伤害和单次系数含义", reason: "当前源树明确5秒总量和0.25单次根系数，但具体伤害间隔/伤害次数未证。" },
  ], [{ kind: "范围", item: "额外敌人数量", reason: "本轮一对一只保留单个敌方承伤载体，不把范围目标数乘入。" }], "当前匿名{d0d3db7f}、TotalDamage的Duration根乘数和DamageDone的0.25均已核对；采用当前150/250/350，不抄旧125/225/325。" );
}

// 辛吉德 P：附近唯一敌方英雄可触发自身移速。
{
  put("singed_p", [
    dataFixed("singed_p", "MSPercent", 1, 0.25, "ms_bonus_ratio", "剧毒冲流移动速度加成比例", "DECIMAL", "当前MSPercent=0.25，正文按×100显示25%；唯一敌方英雄经过也可触发。", 10),
    dataFixed("singed_p", "MSDuration", 1, 2, "ms_duration_ms", "移动速度持续（毫秒）", "INTEGER", "当前MSDuration=2秒，转换为2000毫秒。", 20, ms),
    dataFixed("singed_p", "PerTargetCD", 1, 8, "per_target_cooldown_ms", "每目标冷却（毫秒）", "INTEGER", "当前PerTargetCD=8秒，转换为8000毫秒。", 30, ms),
    dataFixed("singed_p", "TriggerArea", 1, 225, "trigger_area", "触发范围", "INTEGER", "当前TriggerArea=225；只记录范围边界。", 40),
    fixed("cast_time_seconds", "来源施法时间（秒）", "DECIMAL", spellCastSeconds("singed_p", 0.3812499940395355), "当前spellCastTime约0.38125秒，毫秒不是整数，保留来源秒单位。", 50),
  ], [], [
    { kind: "时序", item: "经过、再次进入与每目标冷却", reason: "正文和数据值给出触发范围/持续/冷却，具体再次进入判定未接线。" },
  ], [{ kind: "范围", item: "其他友方英雄触发", reason: "本轮不扩展第三方友军收益，但不排除唯一敌方英雄触发自身移速。" }], "P保留唯一敌方英雄可触发的25%自身移速、2秒和每目标8秒冷却；非整数原始施法时间保持秒。" );
}

// 辛吉德 Q：每秒伤害与4.75展示估计分开，法力成本不在本轮公共参数外新增。
{
  const apRatio = scalar("singed_q", "APRatioPerSecond", 1, 0.425);
  const approximateMultiplier = multiplier("singed_q", "ApproximateTotalDamageTooltip", 4.75);
  put("singed_q", [
    dataLevels("singed_q", "BaseDamagePerSecond", 1, [20, 30, 40, 50, 60], "damage_per_second_base", "剧毒踪迹每秒基础魔法伤害", "INTEGER", "DamagePerSecond取BaseDamagePerSecond索引1至5。", 10),
    fixed("ap_ratio", "每秒伤害法强比例", "DECIMAL", apRatio, "DamagePerSecond树StatByNamedDataValue=0.425；读取来源总法强。", 20),
    dataFixed("singed_q", "ToggleCooldown", 1, 1, "toggle_cooldown_ms", "开关间隔（毫秒）", "INTEGER", "当前ToggleCooldown=1秒，转换为1000毫秒。", 30, ms),
    dataFixed("singed_q", "CloudDuration", 1, 3.25, "cloud_duration_ms", "毒云持续（毫秒）", "INTEGER", "当前CloudDuration=3.25秒，转换为3250毫秒。", 40, ms),
    dataFixed("singed_q", "PoisonDuration", 1, 2, "poison_duration_ms", "毒状态持续（毫秒）", "INTEGER", "当前PoisonDuration=2秒，转换为2000毫秒。", 50, ms),
    dataFixed("singed_q", "TicksPerSecond", 1, 4, "ticks_per_second", "每秒跳数", "INTEGER", "当前TicksPerSecond=4；仅保存来源时序参数。", 60),
    dataFixed("singed_q", "MaxLingerTicks", 1, 8, "max_linger_ticks", "最大残留跳数", "INTEGER", "当前MaxLingerTicks=8；不把它转成任意接触时长。", 70),
    fixed("approximate_total_multiplier", "大概总伤害展示倍率", "DECIMAL", approximateMultiplier, "ApproximateTotalDamageTooltip根mMultiplier=4.75且标记tooltipOnly，仅作来源估计。", 80),
    fixed("cast_time_seconds", "来源施法时间（秒）", "DECIMAL", spellCastSeconds("singed_q", 0.3812499940395355), "当前spellCastTime约0.38125秒，毫秒不是整数，保留来源秒单位。", 90),
  ], [
    formula("damage_per_second", "剧毒踪迹每秒魔法伤害", add(P("damage_per_second_base"), mul(P("ap_ratio"), ap)), "DamagePerSecond = 每秒基础伤害 + 0.425×来源总法强。", 10),
    formula("approximate_total_damage", "剧毒踪迹大概总魔法伤害", mul(P("approximate_total_multiplier"), add(P("damage_per_second_base"), mul(P("ap_ratio"), ap))), "ApproximateTotalDamageTooltip = 4.75×每秒伤害树；仅展示估计，不能当作任意接触时长的必达结果。", 20),
  ], [
    { kind: "时序", item: "毒状态刷新/层叠和实际接触", reason: "当前正文给出云/毒时长、跳数和展示估计，实际接触时长及刷新层叠未接线。" },
    { kind: "资源", item: "每秒法力消耗", reason: "当前keyCost明确为每秒法力；本批公共参数不含开关Q，避免把它误作每次命中费用。" },
  ], [{ kind: "范围", item: "小兵击杀金币", reason: "本轮唯一敌方英雄排除小兵金币分支。" }], "Q保持每秒公式与4.75 tooltipOnly估计，单独记录毒云/毒状态/跳数/残留上限；不凭估计制造周期效果。" );
}

// 辛吉德 W：减速使用客户端整数百分数点，E追加禁锢依赖另列。
{
  put("singed_w", [
    dataLevels("singed_w", "SlowPercent", 1, [50, 55, 60, 65, 70], "slow_percent_points", "强力粘胶减速百分数点", "INTEGER", "当前SlowPercent取索引1至5且正文直接显示百分数，不乘0.01；保存50至70百分数点。", 10),
    dataFixed("singed_w", "WDuration", 1, 3, "duration_ms", "粘胶区域持续（毫秒）", "INTEGER", "当前WDuration=3秒，转换为3000毫秒。", 20, ms),
    dataFixed("singed_w", "WRadius", 1, 265, "radius", "粘胶区域半径", "INTEGER", "当前WRadius=265。", 30),
    dataFixed("singed_w", "DelayExecute", 1, 0.375, "execute_delay_ms", "执行延迟（毫秒）", "INTEGER", "当前DelayExecute=0.375秒，转换为375毫秒。", 40, ms),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("singed_w"), "当前spellCastTime=0.25秒，转换为250毫秒。", 50),
  ], [], [
    { kind: "资格", item: "区域内缚地及E追加禁锢", reason: "W是E追加控制的依赖；区域命中和落点事件未接线。" },
  ], [], "W无伤害公式，但保留当前减速、区域时长/半径和延迟；SlowPercent按整数百分数点保存。" );
}

// 辛吉德 E：基础树、最大生命组件和完整总量分开，最大生命百分数点乘0.01。
{
  const apRatio = coefficient("singed_e", "BaseDamage", 0.55);
  put("singed_e", [
    dataLevels("singed_e", "BaseDamageValue", 1, [50, 60, 70, 80, 90], "base_damage_value", "过肩摔基础伤害值", "INTEGER", "当前BaseDamage树消费BaseDamageValue；取索引1至5。", 10),
    fixed("ap_ratio", "基础伤害法强比例", "DECIMAL", apRatio, "当前BaseDamage树StatByCoefficient=0.55；读取来源总法强。", 20),
    dataLevels("singed_e", "MaxHPDamage", 1, [6, 6.5, 7, 7.5, 8], "max_health_percent_points", "目标最大生命百分数点", "DECIMAL", "当前正文消费MaxHPDamage，取索引1至5；百分数点由0.01转为比例。", 30),
    fixed("percent_points_to_ratio", "百分数点转比例", "DECIMAL", 0.01, "MaxHPDamage为6至8百分数点，完整最大生命组件使用0.01×百分数点。", 40),
    dataLevels("singed_e", "RootDuration", 1, [1, 1.25, 1.5, 1.75, 2], "root_duration_ms", "粘胶命中禁锢持续（毫秒）", "INTEGER", "RootDuration取索引1至5，秒转毫秒；仅在W落点资格成立时使用。", 50, ms),
    dataFixed("singed_e", "FlingDistance", 1, 420, "fling_distance", "投掷距离", "INTEGER", "当前FlingDistance=420。", 60),
    dataFixed("singed_e", "NonChampionDamageCap", 1, 300, "nonchampion_damage_cap", "非英雄最大生命伤害上限", "INTEGER", "当前非英雄封顶300；本轮英雄公式不套用。", 70),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("singed_e"), "当前spellCastTime=0.25秒，转换为250毫秒。", 80),
  ], [
    formula("base_magic_damage", "过肩摔基础魔法伤害", add(P("base_damage_value"), mul(P("ap_ratio"), ap)), "当前BaseDamage树 = BaseDamageValue + 0.55×来源总法强；该树在客户端标为tooltipOnly。", 10),
    formula("max_health_magic_component", "过肩摔最大生命魔法伤害组件", mul(mul(P("percent_points_to_ratio"), P("max_health_percent_points")), targetHp), "正文额外组件 = 0.01×MaxHPDamage百分数点×目标最大生命；兵野封顶不在英雄公式中。", 20),
    formula("total_magic_damage", "过肩摔完整魔法伤害", add(add(P("base_damage_value"), mul(P("ap_ratio"), ap)), mul(mul(P("percent_points_to_ratio"), P("max_health_percent_points")), targetHp)), "完整E = 基础树 + 目标最大生命百分比组件；基础树的tooltipOnly标记不删除正文额外组件。", 30),
  ], [
    { kind: "资格", item: "W落点追加禁锢", reason: "当前正文明确目标摔到W粘胶上才禁锢；落点判定未接线。" },
    { kind: "目标阶段", item: "最大生命属性阶段", reason: "当前只使用目标总最大生命属性；减伤和阶段规则另核。" },
  ], [{ kind: "范围", item: "兵野300上限", reason: "只在非英雄分支使用，本轮唯一敌方英雄不套用该上限。" }], "E保留当前BaseDamage tooltipOnly树中的0.55法强，并额外表达正文最大生命组件；两组件单位分开。" );
}

// 辛吉德 R：移动速度是固定点数，不是比例；重伤只作为Q期间条件。
{
  put("singed_r", [
    dataLevels("singed_r", "StatAmount", 1, [25, 55, 85], "stat_amount", "强化属性点数", "INTEGER", "当前StatAmount取索引1至3；正文同时用于法强、护甲、魔抗、移动速度、生命回复和法力回复，移动速度保存为点数而非比例。", 10),
    dataFixed("singed_r", "Duration", 1, 25, "duration_ms", "疯狂药剂持续（毫秒）", "INTEGER", "当前Duration=25秒，转换为25000毫秒。", 20, ms),
    dataFixed("singed_r", "GrievousAmount", 1, 0.4, "grievous_ratio", "Q期间重伤比例", "DECIMAL", "当前GrievousAmount=0.4，正文按×100显示40%；只在R期间Q条件成立时使用。", 30),
    dataFixed("singed_r", "GrievousDuration", 1, 1, "grievous_duration_ms", "重伤持续（毫秒）", "INTEGER", "当前GrievousDuration=1秒，转换为1000毫秒。", 40, ms),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("singed_r"), "当前spellCastTime=0.25秒，转换为250毫秒。", 50),
  ], [], [
    { kind: "单位", item: "生命/法力回复属性的单位与层", reason: "正文给出属性种类与数值，回复单位和应用层未证，不当成瞬间治疗或资源结果。" },
    { kind: "条件", item: "R期间Q施加重伤", reason: "跨技能条件已由正文确认，具体Q命中事件未接线。" },
  ], [], "StatAmount使用25/55/85点；移动速度明确是点数，不改成25%/55%/85%。回复字段只作为来源范围说明。" );
}

function sourceRecord(skillKey) {
  const hero = sourceHeroOf(skillKey); const bound = sourceSkillOf(skillKey); const summary = sourceSummaryOf(skillKey); const spell = spellOf(skillKey); const heroId = heroIdByKey[hero.key];
  const clientFile = `参考资料/客户端原文/${heroId}.json.gz`; const zhFile = `参考资料/官方中文/${heroId}.json`; const enFile = `参考资料/官方英文/${heroId}.json`;
  return {
    hero: heroId, heroName: hero.name, heroKey: hero.key, slot: bound.slot, resourceType: hero.source.resourceType,
    rootPath: hero.rootPath, spellPath: bound.binding, bindingAvailable: bound.bindingAvailable,
    clientFile, clientSha256: inputIntegrity[clientFile]?.actual ?? null, officialZhFile: zhFile, officialZhSha256: inputIntegrity[zhFile]?.actual ?? null, officialEnFile: enFile, officialEnSha256: inputIntegrity[enFile]?.actual ?? null,
    clientBuild: hero.source.client.contentVersion, currentBoundText: bound.currentTexts,
    raw: { dataValues: clone(spell.DataValues ?? []), calculations: clone(spell.mSpellCalculations ?? {}), fields: {
      spellCastTime: spell.spellCastTime ?? null, mCastTime: spell.mCastTime ?? null, spellTotalTime: spell.spellTotalTime ?? null, cooldownTime: clone(spell.cooldownTime ?? null), mana: clone(spell.mana ?? null), manaValues: clone(spell.manaValues ?? null), mDoesNotConsumeMana: spell.mDoesNotConsumeMana ?? null, mDoesNotConsumeCooldown: spell.mDoesNotConsumeCooldown ?? null,
    } },
    officialEvidence: { zh: clone(officialOf(heroId, bound.slot, "官方中文")), en: clone(officialOf(heroId, bound.slot, "官方英文")) },
    sourceSummary: { officialMaxRank: summary.officialMaxRank, clientCooldown: clone(summary.clientCooldown), clientMana: clone(summary.clientMana), dataValueNames: clone(summary.dataValueNames), calculationNames: clone(summary.calculationNames), note: summary.note },
    selectedData: clone(selectedTrace[skillKey]),
  };
}
function subjectFor(skillKey) {
  const entry = snapshotByRoute.get(`/skills/${skillKey}`); assert(entry?.status === 200 && entry.data, "技能主体保护缺失", skillKey); return clone(entry.data);
}
function componentProtection(skillKey) {
  const result = {};
  for (const [key, endpoint] of [["parameters", "parameters"], ["formulas", "formulas"], ["effects", "effects"], ["processes", "processes"], ["internalStates", "internal-states"], ["triggerRules", "trigger-rules"]]) {
    const entry = snapshotByRoute.get(`/skills/${skillKey}/${endpoint}`); assert(entry?.status === 200 && Array.isArray(entry.data), "组成列表保护缺失", { skillKey, endpoint });
    result[key] = { status: entry.status, count: entry.data.length, dataSha256: sha256(JSON.stringify(entry.data)) };
  }
  const image = snapshotByRoute.get(`/skills/${skillKey}/representative-image`); assert(image?.status === 200, "代表图保护缺失", skillKey);
  result.representativeImage = { status: image.status, dataSha256: sha256(JSON.stringify(image.data)) };
  return result;
}

const reusedPublicParameters = publicReuse.map(item => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false }));
const reusedSet = new Set(reusedPublicParameters.map(item => `${item.skillKey}|${item.parameterKey}`));
assert(reusedSet.size === 30, "公共参数重复", reusedPublicParameters);
function verifyPublic(item) {
  const detail = snapshotByRoute.get(`/skills/${item.skillKey}/parameters/${item.parameterKey}`)?.data;
  assert(detail, "公共参数详情保护缺失", item);
  const heroId = heroIdByKey[heroKeyOf(item.skillKey)]; const spell = officialOf(heroId, slotOf(item.skillKey));
  const expected = item.parameterKey === "cooldown_ms" ? (spell.cooldown ?? []).map(v => v * 1000) : (spell.cost ?? []);
  if (detail.valueMode === "SKILL_LEVEL") {
    const actual = Object.values(detail.levelValues ?? {}).map(Number); assert(actual.length === expected.length && actual.every((v, i) => close(v, expected[i])), "公共等级参数与官方值不符", { item, actual, expected });
  } else { assert(detail.valueMode === "FIXED" && expected.length > 0 && close(Number(detail.fixedValue), expected[0]), "公共固定参数与官方值不符", { item, detail, expected }); }
  return { skillKey: item.skillKey, parameterKey: item.parameterKey, valueMode: detail.valueMode, valueType: detail.valueType, fixedValue: detail.fixedValue, levelValues: detail.levelValues, expectedOfficial: expected, detailSha256: sha256(JSON.stringify(detail)) };
}
const publicVerification = reusedPublicParameters.map(verifyPublic);

const skills = {};
for (const skillKey of order) {
  const subject = subjectFor(skillKey); const slot = slotOf(skillKey);
  skills[skillKey] = {
    skillKey, name: subject.name, maxLevel: subject.maxLevel, currentSubject: subject,
    subjectWrite: { planned: false, reason: `主体、分类、图片和现有组成保护快照；当前候选只计划新增组成。现有分类=${JSON.stringify(subject.skillCategoryKeys)}，来源技能槽=${slot === "P" ? "passive" : "common 或当前空分类"}。` },
    source: sourceRecord(skillKey), write: writes[skillKey], pending: pending[skillKey], excluded: excluded[skillKey], sourceProof: proofs[skillKey], currentProtection: componentProtection(skillKey),
  };
}

const counts = { skills: order.length, parameters: order.reduce((n, k) => n + skills[k].write.parameters.length, 0), formulas: order.reduce((n, k) => n + skills[k].write.formulas.length, 0), effects: order.reduce((n, k) => n + skills[k].write.effects.length, 0), processes: 0, internalStates: 0, triggerRules: 0 };
assert(counts.skills === 20 && counts.formulas >= 27, "候选计数不符", counts);
function walkExpression(node, skillKey, pathText = "expression") {
  assert(node && typeof node === "object", "公式节点不是对象", { skillKey, pathText });
  if (node.nodeType === "PARAMETER") { assert(skills[skillKey].write.parameters.some(p => p.parameterKey === node.parameterKey) || reusedSet.has(`${skillKey}|${node.parameterKey}`), "公式参数引用未定义", { skillKey, node }); return; }
  if (node.nodeType === "ATTRIBUTE") { assert(["SOURCE", "TARGET"].includes(node.attributeOwner), "公式属性所有者非法", node); assert(["TOTAL", "BASE", "BONUS", "CURRENT", "MISSING", "CURRENT_RATIO", "MISSING_RATIO"].includes(node.attributeValueKind), "公式属性取值种类非法", node); assert(attributeKeys.has(node.attributeKey), "公式属性键不在保护字典", node); return; }
  assert(node.nodeType === "OPERATION" && ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MIN", "MAX"].includes(node.operation), "公式操作非法", node);
  assert(Array.isArray(node.operands) && node.operands.length === 2, "公式必须严格为二元", { skillKey, pathText, node });
  walkExpression(node.operands[0], skillKey, `${pathText}.operands[0]`); walkExpression(node.operands[1], skillKey, `${pathText}.operands[1]`);
}
for (const skillKey of order) {
  for (const p of skills[skillKey].write.parameters) {
    const values = p.valueMode === "SKILL_LEVEL" || p.valueMode === "CHARACTER_LEVEL" ? Object.values(p.levelValues ?? {}) : [p.fixedValue];
    if (p.valueType === "INTEGER") assert(values.every(Number.isInteger), "INTEGER参数含小数", { skillKey, p: p.parameterKey, values });
    if (p.parameterKey.endsWith("_ms")) assert(values.every(Number.isInteger), "毫秒参数含小数", { skillKey, p: p.parameterKey, values });
    if (p.valueMode === "RUNTIME_INPUT") assert(p.fixedValue === null && p.levelValues === null, "运行输入不应有默认值", { skillKey, p });
  }
  for (const f of skills[skillKey].write.formulas) walkExpression(f.expression, skillKey, f.formulaKey);
}

const protectedSummary = {
  inputGETs: protection.GETs, protectedSubjects: order.length, protectedCompositionLists: order.length * 6, protectedRepresentativeImages: order.length,
  protectedCharacters: ["champion_evelynn", "champion_lillia", "champion_fiddlesticks", "champion_singed"], protectedCharacterRelations: ["champion_evelynn", "champion_lillia", "champion_fiddlesticks", "champion_singed"],
  protectedCatalogs: ["/attributes", "/skill-categories", "/modifier-zones", "/damage-types"], publicParameterDetails: reusedPublicParameters.length, nonPublicExisting: inputVersion.nonPublicExisting ?? [],
};
const sourceVersion = { clientVersion: source.clientVersion, officialVersion: source.officialVersion, build: source.heroes[0].source.client.contentVersion };
const sourceReview = { conclusionFile: ".agents/artifacts/hero36-cursor-review-run-20260910/Cursor来源复核结论.md", conclusionSha256: sha256File(cursorReviewPath), auditFile: ".agents/artifacts/hero36-cursor-review-run-20260910/主负责人执行审计.json", auditSha256: sha256File(cursorAuditPath), verdict: "READY", runId: cursorAudit.runId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, apiWrites: cursorAudit.apiWrites, gitDelta: cursorAudit.gitDelta };
const sourceRange = {
  generatedAt, batch, revision, status: "候选范围说明；未调用业务接口",
  sourceVersion, inputPackage: ".agents/artifacts/hero36-root-entry-20260910", sourceBindingSha256: sha256File(bindingPath), inputVersionSha256: sha256File(inputVersionPath),
  rootReviewSha256: sha256File(rootReviewPath), cursorReviewSha256: sourceReview.conclusionSha256,
  categories: ["当前正文和树可录确定值", "一对一无关分支", "属性/目标/时序/曲线待核"],
  perSkill: Object.fromEntries(order.map(k => [k, { recordable: skills[k].write.parameters.map(p => p.parameterKey).concat(skills[k].write.formulas.map(f => f.formulaKey)), pending: pending[k], excluded: excluded[k] }])),
  protectedSummary, counts, requestCount: counts.parameters + counts.formulas + counts.effects, publicReuse: reusedPublicParameters.length, apiWrites: 0, noApiCalls: true,
};
const sourceRangeBytes = JSON.stringify(sourceRange, null, 2) + "\n";
const sourceValues = {
  generatedAt, batch, status: "独立冻结源值摘要；未调用业务接口", sourceVersion, sourceBindingSha256: sha256File(bindingPath), sourceReview, inputIntegrity,
  selectedValues: Object.fromEntries(order.map(k => [k, { binding: skills[k].source.spellPath, rawDataValues: skills[k].source.raw.dataValues, calculations: skills[k].source.raw.calculations, selectedData: skills[k].source.selectedData, candidateParameterKeys: skills[k].write.parameters.map(p => p.parameterKey), candidateFormulaKeys: skills[k].write.formulas.map(f => f.formulaKey) }])),
  publicVerification, noApiCalls: true,
};
const sourceValuesBytes = JSON.stringify(sourceValues, null, 2) + "\n";

const candidate = {
  meta: { generatedAt, batch, revision, status: "候选已生成，等待主负责人审查；未调用业务接口", gameId: "lol", apiBase, sourceVersion, sourcePolicy: "固定客户端16.17、官方16.17.1、当前mLocKeys绑定正文和当前计算树；明确值才进入候选，未知实际输入、时序、目标资格和曲线不猜、不设默认。", scope: "伊芙琳、莉莉娅、费德提克、辛吉德20个技能槽；唯一敌方英雄一对一。保留自身收益、同一敌人重复命中、强化技能和控制，排除野怪/小兵/多目标专用分支；未证阶段和时序列为待核。", sourceBindingSha256: sha256File(bindingPath), sourceRangeSha256: sha256(sourceRangeBytes), rootReviewSha256: sha256File(rootReviewPath), sourceReview, inputPackage: ".agents/artifacts/hero36-root-entry-20260910", protectionSnapshotSha256: sha256File(protectionPath), publicReuseSha256: sha256File(publicReusePath), sourceIndexSha256: inputVersion.sourceIndexSha256, currentGETs: protection.GETs, apiCalls: 0, businessWrites: 0, tokenStored: false, candidateSha256: null },
  order, skills, reusedPublicParameters, publicVerification, protectedSummary, counts, requestCount: counts.parameters + counts.formulas + counts.effects, sourceFiles: inputIntegrity,
  sourceNotes: {
    evelynn: "Q MissileDamage使用HateSpikeBaseDamage；E普通/强化互斥；R低于30%为完整伤害×2.4。P等级阈值和每秒治疗曲线无完整求值。",
    lillia: "P总最大生命比例只乘一次且6跳；Q内圈魔法/外圈真实分开；W中心完整值×3替代普通；R非周期性伤害才唤醒。",
    fiddlesticks: "Q使用目标当前生命并保留最小值/近期双倍；W结尾已损生命与英雄折前治疗分开；R当前150/250/350每秒5秒，保留匿名树与0.25单次系数。",
    singed: "Q每秒伤害与4.75展示估计分开且不创建每次法力效果；E含基础树和最大生命组件；R移动速度是点数。",
    indices: "技能DataValues普通等级均按客户端索引1起核对；官方冷却/法力复用按官方索引0核对。",
    attributes: "公式节点使用attributeOwner/attributeKey/attributeValueKind；Q使用TARGET.hp.CURRENT，最大生命组件使用TARGET.hp.TOTAL，法强使用SOURCE.ability_power.TOTAL。",
  }, apiWrites: 0,
};
const candidateBytesWithoutHash = JSON.stringify(candidate, null, 2) + "\n";
candidate.meta.candidateSha256 = sha256(candidateBytesWithoutHash);
const candidateBytes = JSON.stringify(candidate, null, 2) + "\n";

const requests = []; let sequence = 0;
for (const skillKey of order) for (const [kind, identityKey, routeKind] of [["parameters", "parameterKey", "parameters"], ["formulas", "formulaKey", "formulas"], ["effects", "effectKey", "effects"], ["processes", "processKey", "processes"], ["internalStates", "stateKey", "internal-states"], ["triggerRules", "ruleKey", "trigger-rules"]]) for (const body of skills[skillKey].write[kind]) {
  sequence += 1; const stableKey = body[identityKey]; requests.push({ sequence, method: "POST", route: `/skills/${skillKey}/${routeKind}`, detailRoute: `/skills/${skillKey}/${routeKind}/${stableKey}`, skillKey, kind, stableKey, status: "仅意图，未调用", body });
}
assert(requests.length === candidate.requestCount, "请求数量不符", { requests: requests.length, expected: candidate.requestCount });
const protectedRoutes = ["/attributes", "/skill-categories", "/modifier-zones", "/damage-types", ...protectedSummary.protectedCharacters.flatMap(key => [`/characters/${key}`, `/character-skill-relations?characterKey=${key}`]), ...order.flatMap(key => [`/skills/${key}`, `/skills/${key}/representative-image`, `/skills/${key}/parameters`, `/skills/${key}/formulas`, `/skills/${key}/effects`, `/skills/${key}/processes`, `/skills/${key}/internal-states`, `/skills/${key}/trigger-rules`])];
const plan = { generatedAt, status: "仅写入意图，未调用业务接口", batch, revision, apiBase, sourceVersion, candidateSha256: sha256(candidateBytes), sourceBindingSha256: sha256File(bindingPath), sourceRangeSha256: sha256(sourceRangeBytes), protectionSnapshotSha256: sha256File(protectionPath), publicReuseSha256: sha256File(publicReusePath), requestCount: requests.length, counts, reusedPublicParameters, publicVerification, protectedRoutes, protectedSummary, requests, noApiCalls: true, apiWrites: 0 };
const planBytes = JSON.stringify(plan, null, 2) + "\n";

writeText(path.join(artifactDir, "完整候选.json"), candidateBytes);
writeText(path.join(artifactDir, "请求计划.json"), planBytes);
writeText(path.join(artifactDir, "来源值摘要.json"), sourceValuesBytes);
writeText(path.join(artifactDir, "来源与范围.json"), sourceRangeBytes);
writeJson(path.join(artifactDir, "候选版本.json"), { generatedAt, batch, revision, sourceVersion, counts, requestCount: requests.length, publicReuse: reusedPublicParameters.length, candidateSha256: sha256(candidateBytes), planSha256: sha256(planBytes), sourceValuesSha256: sha256(sourceValuesBytes), sourceRangeSha256: sha256(sourceRangeBytes), strictMath: "独立数学核算.mjs", strictMathStatus: "待执行", businessWrites: 0, apiCalls: 0, protectedSummary, noApiCalls: true });
writeJson(path.join(artifactDir, "来源哈希汇总.json"), { generatedAt, batch, inputPackage: ".agents/artifacts/hero36-root-entry-20260910", inputIntegrity, frozen: { inputVersionSha256: sha256File(inputVersionPath), bindingSha256: sha256File(bindingPath), protectionSha256: sha256File(protectionPath), publicReuseSha256: sha256File(publicReusePath), interfaceSampleSha256: sha256File(interfaceSamplePath), attributeBoundarySha256: sha256File(attributeBoundaryPath), rootReviewSha256: sha256File(rootReviewPath) }, cursorReview: sourceReview, outputs: { candidateSha256: sha256(candidateBytes), planSha256: sha256(planBytes), sourceValuesSha256: sha256(sourceValuesBytes), sourceRangeSha256: sha256(sourceRangeBytes) }, apiWrites: 0 });
const readme = `# 第三十六批候选\n\n本目录保存伊芙琳、莉莉娅、费德提克、辛吉德20个技能槽的静态候选和请求意图。输入固定客户端16.17、官方资料16.17.1、当前绑定正文及计算树；保护快照202次GET且业务写入为0，Cursor来源复核为READY。\n\n30项已有公共冷却/法力参数只复用，不更新或重建；辛吉德Q的每秒法力成本保持来源范围说明。主体、代表图、角色与关系、六类组成列表及既有详情均记录为保护状态。\n\n候选严格按普通技能DataValues索引1起核对，官方公共参数按索引0核对；时间值按来源单位转换为毫秒整数，非整数原始施法时间保留秒。公式节点严格二元，法强、目标最大生命和目标当前生命分别使用当前属性节点。\n\n范围边界：保留自身收益、同一敌人重复命中、强化技能与控制；排除野怪、小兵、额外敌人及纯展示/金币分支。伊芙琳E普通与强化互斥，莉莉娅P总比例不逐跳重复，费德提克Q使用目标当前生命，费德提克R使用当前150/250/350每秒源值，辛吉德R移动速度保存为点数。未知等级求值、属性阶段、目标资格和时序使用无默认运行输入或列为待核。\n\n完整候选、请求计划、来源值摘要、来源与范围和独立数学脚本均为候选阶段文件，不代表业务入库、页面验收或战斗运行。\n`;
writeText(path.join(artifactDir, "README.md"), readme);
for (const file of ["完整候选.json", "请求计划.json", "来源值摘要.json", "来源与范围.json", "候选版本.json", "来源哈希汇总.json", "README.md"]) {
  fs.mkdirSync(durableDir, { recursive: true });
  fs.copyFileSync(path.join(artifactDir, file), path.join(durableDir, file));
}

console.log(JSON.stringify({ batch, generatedAt, counts, requestCount: requests.length, candidateSha256: sha256(candidateBytes), planSha256: sha256(planBytes), sourceValuesSha256: sha256(sourceValuesBytes), sourceRangeSha256: sha256(sourceRangeBytes), apiWrites: 0 }, null, 2));
