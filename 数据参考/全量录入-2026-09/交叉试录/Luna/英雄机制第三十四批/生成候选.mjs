import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero34-root-entry-20260910");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十四批");
const batch = "英雄机制第三十四批";
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
const semanticNotePath = path.join(inputDir, "来源关键语义补充.md");
const rootReviewPath = path.join(inputDir, "主负责人源值核对说明.md");
const cursorReviewDir = path.join(repo, ".agents/artifacts/hero34-cursor-review-run-20260910");
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

assert(inputVersion.clientVersion === "16.17" && inputVersion.officialVersion === "16.17.1", "冻结来源版本不符");
assert(inputVersion.GETs === 198 && inputVersion.apiWrites === 0, "输入包不是198次只读GET", inputVersion);
assert(protection.GETs === 198 && protection.apiWrites === 0 && (protection.businessWrites === undefined || protection.businessWrites === 0), "保护快照不是只读198 GET", protection);
assert(publicReuse.length === 26, "公共参数复用数量不符", publicReuse.length);
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
  champion_katarina: "Katarina",
  champion_leblanc: "Leblanc",
  champion_vex: "Vex",
  champion_zilean: "Zilean",
};
const officialSpellIndex = { Q: 0, W: 1, E: 2, R: 3 };
const order = [
  "katarina_p", "katarina_q", "katarina_w", "katarina_e", "katarina_r",
  "leblanc_p", "leblanc_q", "leblanc_w", "leblanc_e", "leblanc_r",
  "vex_p", "vex_q", "vex_w", "vex_e", "vex_r",
  "zilean_p", "zilean_q", "zilean_w", "zilean_e", "zilean_r",
];
const slotOf = key => key.slice(-1).toUpperCase();
const heroKeyOf = key => `champion_${key.split("_")[0]}`;
const sourceHeroOf = key => source.heroes.find(hero => hero.key === heroKeyOf(key));
const sourceSkillOf = key => sourceHeroOf(key)?.skills.find(skill => skill.skillKey === key);
const sourceSummaryOf = key => sourceHeroOf(key)?.source.skills.find(skill => skill.slot === slotOf(key));
const spellOf = key => sourceSkillOf(key)?.object?.mSpell;
const snapshotByRoute = new Map((protection.requests ?? []).map(item => [item.route, item]));
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
for (const key of ["ability_power", "attack_damage", "attack_speed", "hp"]) {
  assert(attributeKeys.has(key), "属性字典缺少候选需要的键", key);
}

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
  assert(actual.every(value => typeof value === "number" && Number.isFinite(value)), "DataValues等级值缺失", { skillKey, name, start, actual });
  assert(actual.length === expected.length && actual.every((value, i) => close(value, expected[i])), "DataValues索引或数值不符", { skillKey, name, start, actual, expected });
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
function breakpoints(skillKey, name, expectedBase, expectedEntries) {
  const c = calc(skillKey, name);
  const all = [];
  const walk = value => {
    if (!value || typeof value !== "object") return;
    if (value.__type === "ByCharLevelBreakpointsCalculationPart") all.push(value);
    Object.values(value).forEach(walk);
  };
  walk(c);
  assert(all.length > 0, "角色等级断点树缺失", { skillKey, name });
  const found = all.find(part => {
    const actualEntries = (part.mBreakpoints ?? []).map(x => [x.mLevel, x.mAdditionalBonusAtThisLevel]);
    return close(part.mLevel1Value, expectedBase)
      && actualEntries.length === expectedEntries.length
      && actualEntries.every((entry, index) => entry[0] === expectedEntries[index][0] && close(entry[1], expectedEntries[index][1]));
  });
  assert(found, "角色等级断点来源不符", { skillKey, name, expectedBase, expectedEntries, actual: all });
}
function characterCurve(skillKey, name, expected) {
  const c = calc(skillKey, name);
  const part = c.mFormulaParts?.find(item => item.__type === "ByCharLevelFormulaCalculationPart");
  assert(part && Array.isArray(part.values), "角色等级曲线树缺失", { skillKey, name });
  const actual = expected.map((_, i) => part.values[i + 1]);
  assert(actual.every((value, i) => close(value, expected[i])), "角色等级曲线值不符", { skillKey, name, actual, expected });
  return actual.map(clean);
}
function ms(sec) {
  assert(close(sec * 1000, Math.round(sec * 1000)), "秒转毫秒不是整数", sec);
  return Math.round(sec * 1000);
}
function directParam(key, name, type, mode, fixedValue, levelValues, description, sortOrder) {
  return { parameterKey: key, name, valueType: type, valueMode: mode, fixedValue: fixedValue ?? null, levelValues: levelValues ? Object.fromEntries(levelValues.map((v, i) => [String(i + 1), clean(v)])) : null, description, sortOrder };
}
const fixed = (key, name, type, value, description, sortOrder) => directParam(key, name, type, "FIXED", clean(value), null, description, sortOrder);
const levels = (key, name, type, values, description, sortOrder) => directParam(key, name, type, "SKILL_LEVEL", null, values, description, sortOrder);
const charLevels = (key, name, type, values, description, sortOrder) => directParam(key, name, type, "CHARACTER_LEVEL", null, values, description, sortOrder);
const runtime = (key, name, type, description, sortOrder) => directParam(key, name, type, "RUNTIME_INPUT", null, null, description, sortOrder);
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const add = (a, b) => O("ADD", a, b);
const sub = (a, b) => O("SUBTRACT", a, b);
const mul = (a, b) => O("MULTIPLY", a, b);
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const ap = A("SOURCE", "ability_power", "TOTAL");
const bonusAd = A("SOURCE", "attack_damage", "BONUS");
const one = key => fixed(key, "完整量基准", "DECIMAL", 1, "来源树中的完整量基准；不是额外游戏输入。", 999);

const valueRule = (kind, key) => ({ value: kind === "PARAMETER" ? { kind, parameterKey: key } : { kind, formulaKey: key }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const timedLifecycle = durationParameterKey => ({
  durationValue: { kind: "PARAMETER", parameterKey: durationParameterKey },
  maxStacksValue: { kind: "FIXED", value: 1 }, applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope: "SOURCE", reapplicationStackMode: "KEEP", reapplicationDurationMode: "REFRESH_ALL",
  expiryMode: "ALL_AT_ONCE", periodicIntervalValue: null, firstPeriodicExecution: null,
});
const persistentBehavior = () => ({ moment: "PERSISTENT", valueReadMode: "APPLICATION_SNAPSHOT", stackValueMode: "SHARED", reapplicationValueMode: "REPLACE", periodicExecutionMode: null });
const normalShield = (effectKey, name, formulaKey, durationKey, absorbedDamageTypeKey, description, sortOrder = 10) => ({
  effectKey, name, description, sortOrder, lifecycle: timedLifecycle(durationKey), results: [{
    resultKey: "shield", name, resultType: "NORMAL_SHIELD", target: "SOURCE", description: null,
    sortOrder: 10, lifecycleBehavior: persistentBehavior(), spellShieldBlockScope: null,
    valueRule: valueRule("FORMULA", formulaKey), detail: { absorbedDamageTypeKey, decayMode: "NONE" },
  }],
});

const writes = {}; const pending = {}; const excluded = {}; const proofs = {};
const put = (skillKey, parameters, formulas, effects, pendingItems, excludedItems, proof) => {
  writes[skillKey] = { parameters, formulas, effects, processes: [], internalStates: [], triggerRules: [] };
  pending[skillKey] = pendingItems; excluded[skillKey] = excludedItems; proofs[skillKey] = proof;
};
const dataParam = (skillKey, dataName, start, expected, key, name, type, description, sortOrder) => levels(key, name, type, selected(skillKey, dataName, start, expected), description, sortOrder);
const dataFixed = (skillKey, dataName, start, expected, key, name, type, description, sortOrder) => fixed(key, name, type, scalar(skillKey, dataName, start, expected), description, sortOrder);
const dataParamSeconds = (skillKey, dataName, start, expected, key, name, type, description, sortOrder) => levels(key, name, type, selected(skillKey, dataName, start, expected).map(ms), description, sortOrder);
const dataFixedSeconds = (skillKey, dataName, start, expected, key, name, type, description, sortOrder) => fixed(key, name, type, ms(scalar(skillKey, dataName, start, expected)), description, sortOrder);
const spellCastMs = skillKey => {
  const value = spellOf(skillKey)?.spellCastTime;
  assert(typeof value === "number" && Number.isFinite(value), "spellCastTime缺失", skillKey);
  return ms(value);
};
const spellCastSeconds = (skillKey, expected) => {
  const value = spellOf(skillKey)?.spellCastTime;
  assert(typeof value === "number" && close(value, expected), "spellCastTime不符", { skillKey, expected, value });
  return clean(expected);
};
const calcFixed = (skillKey, calcName, expected, key, name, type, description, sortOrder) => fixed(key, name, type, coefficient(skillKey, calcName, expected), description, sortOrder);

// 卡特琳娜 P：完整角色等级基础曲线、匕首参数和同版窄口径的AD/AP树。
{
  const base = [68.1846160889,72.13845825195,76.861541748,82.35384368896,88.61538696289,95.64615631104,103.4461517334,112.0153808594,121.35384368896,131.4615325928,142.3384552002,153.9846191406,166.3999938965,179.5846099854,193.5384674072,208.2615356445,223.7538452148,240.0153808594];
  characterCurve("katarina_p", "TotalDamage", base); breakpoints("katarina_p", "TotalDamage", 0.69999999, [[6,0.1],[11,0.1],[16,0.1]]);
  const ad = dataFixed("katarina_p", "BonusADRatio", 0, 0.6, "bonus_ad_ratio", "匕首额外攻击力比例", "DECIMAL", "TotalDamage树的mStat=2、mStatFormula=2窄口径；按来源额外攻击力读取。", 50);
  put("katarina_p", [
    dataFixedSeconds("katarina_p", "ResetWindow", 0, 3, "reset_window_ms", "击杀判定窗口（毫秒）", "INTEGER", "客户端ResetWindow为3秒，转换为3000毫秒。", 10),
    dataFixedSeconds("katarina_p", "ResetCDR", 0, 15, "reset_cooldown_reduction_ms", "击杀后技能冷却减少（毫秒）", "INTEGER", "客户端ResetCDR为15秒，转换为15000毫秒；实际击杀事件未接线。", 20),
    dataFixed("katarina_p", "DaggerRadius", 0, 340, "dagger_radius", "匕首斩击范围", "INTEGER", "客户端DaggerRadius为340；仅保存当前正文载体范围。", 30),
    dataFixedSeconds("katarina_p", "DaggerDuration", 0, 4, "dagger_duration_ms", "匕首存在时间（毫秒）", "INTEGER", "客户端DaggerDuration为4秒，转换为4000毫秒。", 40),
    ad,
    directParam("character_level_base_damage", "角色等级下匕首基础魔法伤害", "DECIMAL", "CHARACTER_LEVEL", null, base, "当前TotalDamage的ByCharLevelFormulaCalculationPart直接取角色等级1至18值；不把曲线改成技能等级。", 60),
    charLevels("ap_ratio_by_character_level", "角色等级法强比例", "DECIMAL", [0.7,0.7,0.7,0.7,0.7,0.8,0.8,0.8,0.8,0.8,0.9,0.9,0.9,0.9,0.9,1,1,1], "TotalDamage树断点：起点0.7，角色等级6/11/16各增加0.1。", 70),
  ], [formula("dagger_magic_damage", "贪婪匕首魔法伤害", add(add(P("character_level_base_damage"), mul(P("bonus_ad_ratio"), bonusAd)), mul(P("ap_ratio_by_character_level"), ap)), "TotalDamage = 角色等级基础值 + 0.6×来源额外攻击力 + 角色等级法强比例×来源总法强；保留匕首唯一敌人伤害载体。", 10)], [], [
    { kind: "时序", item: "击杀重置、匕首拾取和斩击命中", reason: "当前正文与参数明确窗口/范围，自动触发和命中时点未接线。" },
    { kind: "属性阶段", item: "mStat=2/mStatFormula=2", reason: "仅沿已有同版窄口径使用来源额外攻击力；未扩展全部选择器枚举。" },
  ], [{ kind: "范围", item: "匕首附近多个敌人的分配", reason: "本轮只保留唯一敌人载体，不把多目标数乘入单目标公式。" }], "TotalDamage为完整角色等级曲线；AP断点和mStat=2额外攻击力项均来自当前绑定树，未借用主动技能数据。" );
}

// 卡特琳娜 Q
{
  put("katarina_q", [
    dataParam("katarina_q", "BaseDamage", 1, [80,115,150,185,220], "base_damage", "基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5；索引0的45不是技能等级1。", 10),
    dataFixed("katarina_q", "BounceOffset", 1, 350, "bounce_offset", "弹射偏移距离", "INTEGER", "客户端BounceOffset取索引1；仅保留弹射几何参数。", 20),
    dataFixed("katarina_q", "BounceRadius", 1, 450, "bounce_radius", "弹射范围半径", "INTEGER", "客户端BounceRadius取索引1；仅保留弹射几何参数。", 30),
    dataFixed("katarina_q", "MaxBounces", 1, 2, "max_bounces", "最大弹射次数", "INTEGER", "客户端MaxBounces取索引1；唯一敌人公式不自动重复弹射。", 40),
    dataFixed("katarina_q", "QAPRatio", 1, 0.4, "ap_ratio", "法强比例", "DECIMAL", "TotalDamage树的QAPRatio项读取来源总法强。", 50),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("katarina_q"), "当前根spellCastTime=0.25秒，转换为250毫秒。", 60),
  ], [formula("magic_damage", "弹射之刃魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "TotalDamage = BaseDamage + QAPRatio×来源总法强；只表示唯一敌人单次载体。", 10)], [], [
    { kind: "时序", item: "匕首落地与弹射命中", reason: "MaxBounces及几何参数有来源，具体同目标是否重复命中未接线。" },
  ], [{ kind: "范围", item: "附近多个敌人", reason: "唯一敌人范围不把MaxBounces乘入单目标伤害。" }], "Q使用DataValues索引1至5的基础值，并保留弹射几何来源。" );
}

// 卡特琳娜 W
{
  put("katarina_w", [
    dataFixedSeconds("katarina_w", "MovespeedDuration", 1, 1.25, "movement_speed_duration_ms", "移动速度增益持续（毫秒）", "INTEGER", "客户端MovespeedDuration取索引1的1.25秒，转换为1250毫秒。", 10),
    dataParam("katarina_w", "MovespeedAmount", 1, [50,60,70,80,90], "movement_speed_percent_points", "移动速度增益百分数点", "INTEGER", "客户端MovespeedAmount取技能等级索引1至5；索引0的40不是等级1。", 20),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("katarina_w"), "当前根spellCastTime=0.25秒，转换为250毫秒。", 30),
  ], [], [], [
    { kind: "时序", item: "移动速度随时间衰减和匕首落地", reason: "正文明确持续衰减，当前树没有可保存的衰减函数；不造周期过程。" },
  ], [], "W没有当前计算树；只保存正文消费的自身移动速度持续和值，匕首作为P技能载体留在来源说明。" );
}

// 卡特琳娜 E
{
  breakpoints("katarina_e", "{016cd4b3}", 0.77999997, [[6,0.06],[11,0.06],[16,0.06],[21,0.04]]);
  put("katarina_e", [
    dataParam("katarina_e", "BaseDamage", 1, [20,30,40,50,60], "base_damage", "基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5；索引0的10不是等级1。", 10),
    dataParam("katarina_e", "DataCooldown", 1, [12,11,10,9,8], "data_cooldown_seconds", "匕首冷却缩减基准（秒）", "DECIMAL", "DaggerCooldownReduction树引用DataCooldown索引1至5，保留来源秒单位。", 20),
    dataFixed("katarina_e", "EADRatio", 1, 0.4, "bonus_ad_ratio", "额外攻击力比例", "DECIMAL", "TotalDamage树mStat=2项的EADRatio=0.4，按来源额外攻击力读取。", 30),
    dataFixed("katarina_e", "EAPRatio", 1, 0.25, "ap_ratio", "法强比例", "DECIMAL", "TotalDamage树的EAPRatio=0.25，读取来源总法强。", 40),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("katarina_e"), "当前根spellCastTime=0，保留0毫秒。", 50),
    charLevels("dagger_cooldown_ratio_by_character_level", "角色等级匕首冷却缩减比例", "DECIMAL", [0.78,0.78,0.78,0.78,0.78,0.84,0.84,0.84,0.84,0.84,0.9,0.9,0.9,0.9,0.9,0.96,0.96,0.96], "匿名子树角色等级1至18：起点0.78，6/11/16各加0.06；等级21的0.04在本批范围外。", 60),
    runtime("actual_cooldown_multiplier", "实际冷却倍率", "DECIMAL", "外层CooldownMultiplierCalculationPart的实际冷却系数；来源未证完整选择器，不设置默认。", 70),
    fixed("milliseconds_per_second", "每秒毫秒换算系数", "INTEGER", 1000, "将DataCooldown秒数换算为接口公式的毫秒结果；单位换算常数，不是游戏平衡输入。", 80),
  ], [
    formula("magic_damage", "瞬步魔法伤害", add(add(P("base_damage"), mul(P("ap_ratio"), ap)), mul(P("bonus_ad_ratio"), bonusAd)), "TotalDamage = BaseDamage + EAPRatio×来源总法强 + EADRatio×来源额外攻击力；目标为敌人或范围内最近敌人的资格待接。", 10),
    formula("dagger_cooldown_reduction_ms", "拾取匕首缩短冷却（毫秒）", mul(mul(mul(P("dagger_cooldown_ratio_by_character_level"), P("actual_cooldown_multiplier")), P("data_cooldown_seconds")), P("milliseconds_per_second")), "DaggerCooldownReduction = 角色等级比例×实际冷却倍率×DataCooldown秒×1000；保留匿名修改树及单位换算，不猜倍率。", 20),
  ], [], [
    { kind: "输入", item: "actual_cooldown_multiplier", reason: "冷却倍率是未窄证实际输入；缺值时拒绝求值。" },
    { kind: "目标资格", item: "友军、敌人、匕首三种目标分支", reason: "正文给出分支，但当前候选只保存数值，不预先制造命中事件。" },
  ], [], "E完整保留TotalDamage和当前正文消费的DaggerCooldownReduction；角色等级21断点只保留来源审计，不进入1至18级参数。" );
}

// 卡特琳娜 R
{
  const adRatio = coefficient("katarina_r", "ADDamageCalc", 0.16);
  const asRatio = coefficient("katarina_r", "ADDamageCalc", 3.125);
  const oneRatio = one("one_ratio");
  put("katarina_r", [
    dataParam("katarina_r", "DamagePerTick", 1, [25,37.5,50], "magic_base_damage_per_tick", "每次魔法伤害基础值", "DECIMAL", "客户端DamagePerTick取R技能等级索引1至3；索引0为12.5占位。", 10),
    dataFixed("katarina_r", "RAPRatio", 1, 0.19, "magic_ap_ratio", "每次魔法伤害法强比例", "DECIMAL", "DamageCalc树的RAPRatio=0.19，读取来源总法强。", 20),
    dataFixed("katarina_r", "TicksPerSecond", 1, 6, "ticks_per_second", "每秒伤害次数", "INTEGER", "客户端TicksPerSecond取索引1；仅用于当前总量树。", 30),
    dataFixed("katarina_r", "Duration", 1, 2.5, "duration_seconds", "持续时间（秒）", "DECIMAL", "客户端Duration取索引1的2.5秒；总量公式保留来源单位。", 40),
    dataParamSeconds("katarina_r", "GrievousDuration", 1, [3,3,3], "grievous_duration_ms", "重伤持续（毫秒）", "INTEGER", "客户端GrievousDuration取索引1至3，秒转毫秒。", 50),
    dataParam("katarina_r", "GrievousAmount", 1, [0.4,0.4,0.4], "grievous_amount_ratio", "重伤效果比例", "DECIMAL", "客户端GrievousAmount取索引1至3；正文按比例×100显示百分数。", 60),
    dataParam("katarina_r", "OnHitRatio", 1, [0.25,0.3,0.35], "on_hit_ratio", "攻击特效和附伤比例", "DECIMAL", "客户端OnHitRatio取R等级索引1至3的比例值；正文按百分数显示。", 70),
    fixed("bonus_ad_ratio", "物理伤害额外攻击力比例", "DECIMAL", adRatio, "ADDamageCalc内部0.16项，按来源额外攻击力读取。", 80),
    fixed("attack_speed_coefficient", "物理伤害攻速比例系数", "DECIMAL", asRatio, "ADDamageCalc内部3.125项；攻速输入仍保持原比例单位。", 90),
    oneRatio,
    runtime("actual_attack_speed_ratio", "实际攻击速度比例", "DECIMAL", "ADDamageCalc的mStat=4、mStatFormula=2选择器未在本批窄证，使用无默认实际输入。", 100),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("katarina_r"), "当前根spellCastTime=0。", 110),
  ], [
    formula("magic_damage_per_tick", "死亡莲华每次魔法伤害", add(P("magic_base_damage_per_tick"), mul(P("magic_ap_ratio"), ap)), "DamageCalc = DamagePerTick + RAPRatio×来源总法强。", 10),
    formula("total_magic_damage", "死亡莲华同一目标总魔法伤害", mul(mul(P("ticks_per_second"), P("duration_seconds")), add(P("magic_base_damage_per_tick"), mul(P("magic_ap_ratio"), ap))), "TotalDamageCalc = TicksPerSecond×Duration×DamageCalc；同一目标持续多次，唯一敌人不再乘目标数。", 20),
    formula("physical_damage_per_tick", "死亡莲华每次物理伤害", mul(mul(P("bonus_ad_ratio"), bonusAd), add(P("one_ratio"), mul(P("attack_speed_coefficient"), P("actual_attack_speed_ratio")))), "ADDamageCalc = 0.16×来源额外攻击力×(1+3.125×实际攻速比例)；mStat=4阶段无默认。", 30),
    formula("total_physical_damage", "死亡莲华同一目标总物理伤害", mul(mul(P("ticks_per_second"), P("duration_seconds")), mul(mul(P("bonus_ad_ratio"), bonusAd), add(P("one_ratio"), mul(P("attack_speed_coefficient"), P("actual_attack_speed_ratio"))))), "TotalADDamageCalc = TicksPerSecond×Duration×ADDamageCalc；当前目标上限、攻击时点与攻速输入待接。", 40),
  ], [], [
    { kind: "输入", item: "actual_attack_speed_ratio", reason: "mStat=4/mStatFormula=2具体属性阶段未窄证；缺值时拒绝物理公式。" },
    { kind: "时序", item: "6次/秒持续2.5秒、重伤与攻击特效", reason: "树给出总量关系，事件时点和攻击特效接线未完成。" },
  ], [{ kind: "范围", item: "第二、第三敌人", reason: "正文最多3名敌方英雄；唯一敌人候选不将单目标量乘3。" }], "R四棵当前树均保留；魔法和物理总量按同一TicksPerSecond×Duration根乘积，物理完整式保留3.125攻速项。" );
}

// 乐芙兰 P
{
  put("leblanc_p", [
    dataFixedSeconds("leblanc_p", "Cooldown", 1, 60, "passive_cooldown_ms", "被动冷却时间（毫秒）", "INTEGER", "客户端Cooldown取索引1的60秒，转换为60000毫秒。", 10),
    fixed("health_threshold_percent_points", "触发最大生命百分数点", "INTEGER", 40, "当前绑定正文明确低于最大生命值40%触发。", 20),
    fixed("invisibility_duration_ms", "隐形持续（毫秒）", "INTEGER", 1000, "当前绑定正文明确隐形1秒，转换为1000毫秒。", 30),
    fixed("illusion_duration_ms", "幻像持续（毫秒）", "INTEGER", 8000, "当前绑定正文明确无伤害幻像持续8秒，转换为8000毫秒。", 40),
  ], [], [], [
    { kind: "时序", item: "低生命触发、隐形和本体保护", reason: "当前正文给出触发和时长，状态触发事件未接线。" },
  ], [{ kind: "范围", item: "无伤害幻像作为独立载体", reason: "正文明确幻像不能造成伤害，本轮不创建自主召唤伤害。" }], "P只保存本体触发和保护参数；幻像不作为伤害技能录入。" );
}

// 乐芙兰 Q
{
  put("leblanc_q", [
    dataParam("leblanc_q", "BaseDamage", 1, [65,90,115,140,165], "base_damage", "初始基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5；索引0的40不是等级1。", 10),
    dataParam("leblanc_q", "BaseMarkDamage", 1, [65,90,115,140,165], "mark_base_damage", "魔印引爆基础魔法伤害", "INTEGER", "客户端BaseMarkDamage取索引1至5。", 20),
    dataFixedSeconds("leblanc_q", "MarkDuration", 1, 3.5, "mark_duration_ms", "魔印持续（毫秒）", "INTEGER", "客户端MarkDuration取索引1的3.5秒，转换为3500毫秒。", 30),
    dataFixed("leblanc_q", "CooldownRefund", 1, 0.3, "cooldown_refund_ratio", "击杀后剩余冷却返还比例", "DECIMAL", "客户端CooldownRefund=0.3；只保留击杀条件参数。", 40),
    dataFixed("leblanc_q", "ManaRefund", 1, 1, "mana_refund_ratio", "击杀后法力返还比例", "DECIMAL", "客户端ManaRefund=1；只保留击杀条件参数。", 50),
    dataFixed("leblanc_q", "APRatio", 1, 0.4, "ap_ratio", "法强比例", "DECIMAL", "Damage和MarkDamage树均消费APRatio×来源总法强。", 60),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("leblanc_q"), "当前根spellCastTime=0.25秒，转换为250毫秒。", 70),
  ], [
    formula("initial_magic_damage", "恶意魔印初始魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "Damage = BaseDamage + APRatio×来源总法强。", 10),
    formula("mark_magic_damage", "恶意魔印引爆魔法伤害", add(P("mark_base_damage"), mul(P("ap_ratio"), ap)), "MarkDamage = BaseMarkDamage + APRatio×来源总法强。", 20),
  ], [], [
    { kind: "时序", item: "标记命中、引爆和击杀返还", reason: "两段同一目标数值保留，实际标记/击杀事件未接线。" },
  ], [{ kind: "范围", item: "小兵额外伤害", reason: "BonusMinionDamage是小兵专用分支，不进入唯一敌方英雄范围。" }], "Q保留初始与引爆两棵当前树，公共冷却与法力只复用保护值。" );
}

// 乐芙兰 W
{
  put("leblanc_w", [
    dataFixed("leblanc_w", "WAPRatio", 1, 0.9, "ap_ratio", "法强比例", "DECIMAL", "TotalDamage树消费WAPRatio=0.9×来源总法强。", 10),
    dataParam("leblanc_w", "BaseDamage", 1, [75,115,155,195,235], "base_damage", "基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5；索引0的35不是等级1。", 20),
    dataFixedSeconds("leblanc_w", "SnapbackTimeAllowed", 1, 4, "snapback_window_ms", "返回初始位置窗口（毫秒）", "INTEGER", "客户端SnapbackTimeAllowed取索引1的4秒，转换为4000毫秒。", 30),
    dataFixedSeconds("leblanc_w", "SnapbackDelay", 1, 0.2, "snapback_delay_ms", "返回延迟（毫秒）", "INTEGER", "客户端SnapbackDelay取索引1的0.2秒，转换为200毫秒。", 40),
    dataFixedSeconds("leblanc_w", "SnapbackQueueWindow", 1, 0.2, "snapback_queue_window_ms", "返回排队窗口（毫秒）", "INTEGER", "客户端SnapbackQueueWindow取索引1的0.2秒，转换为200毫秒。", 50),
    dataFixed("leblanc_w", "SpellMaxRange", 1, 600, "spell_max_range", "技能最大射程", "INTEGER", "客户端SpellMaxRange取索引1的600。", 60),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("leblanc_w"), "当前根spellCastTime=0.25秒，转换为250毫秒。", 70),
  ], [formula("magic_damage", "魔影迷踪魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "TotalDamage = BaseDamage + WAPRatio×来源总法强。", 10)], [], [
    { kind: "时序", item: "冲刺命中和4秒内返回", reason: "当前正文给出返回窗口，命中和重施资格未接线。" },
  ], [], "W保留唯一敌人伤害载体、自身位移返回窗口和射程；不把位移重施当作伤害重复事件。" );
}

// 乐芙兰 E
{
  put("leblanc_e", [
    dataParam("leblanc_e", "BaseInitialDamage", 1, [50,70,90,110,130], "initial_base_damage", "首段基础魔法伤害", "INTEGER", "客户端BaseInitialDamage取索引1至5；索引0的30不是等级1。", 10),
    dataParam("leblanc_e", "BaseDelayedDamage", 1, [80,120,160,200,240], "delayed_base_damage", "延迟基础魔法伤害", "INTEGER", "客户端BaseDelayedDamage取索引1至5；索引0的40不是等级1。", 20),
    dataFixed("leblanc_e", "InitialAPRatio", 1, 0.4, "initial_ap_ratio", "首段法强比例", "DECIMAL", "InitialDamage树消费InitialAPRatio×来源总法强。", 30),
    dataFixed("leblanc_e", "DelayedAPRatio", 1, 0.85, "delayed_ap_ratio", "延迟段法强比例", "DECIMAL", "DelayedDamage树消费DelayedAPRatio×来源总法强。", 40),
    dataFixedSeconds("leblanc_e", "TetherDuration", 1, 1.5, "tether_duration_ms", "束缚持续（毫秒）", "INTEGER", "客户端TetherDuration取索引1的1.5秒，转换为1500毫秒。", 50),
    dataFixedSeconds("leblanc_e", "RootDuration", 1, 1.5, "root_duration_ms", "禁锢持续（毫秒）", "INTEGER", "客户端RootDuration取索引1的1.5秒，转换为1500毫秒。", 60),
    dataFixed("leblanc_e", "TetherDistance", 1, 865, "tether_distance", "锁链距离", "INTEGER", "客户端TetherDistance取索引1的865。", 70),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("leblanc_e"), "当前根spellCastTime=0.25秒，转换为250毫秒。", 80),
  ], [
    formula("initial_magic_damage", "幻影锁链首段魔法伤害", add(P("initial_base_damage"), mul(P("initial_ap_ratio"), ap)), "InitialDamage = BaseInitialDamage + InitialAPRatio×来源总法强。", 10),
    formula("delayed_magic_damage", "幻影锁链延迟魔法伤害", add(P("delayed_base_damage"), mul(P("delayed_ap_ratio"), ap)), "DelayedDamage = BaseDelayedDamage + DelayedAPRatio×来源总法强。", 20),
  ], [], [
    { kind: "时序", item: "首段、持续束缚、延迟伤害和禁锢", reason: "当前正文明确同一目标两段条件，断链与控制事件未接线。" },
  ], [{ kind: "范围", item: "非首个命中敌人", reason: "正文限定命中的第一个敌人。" }], "E两棵当前树按同一目标首段/持续段分别保存，所有时长采用整数毫秒。" );
}

// 乐芙兰 R：五棵自身复制技能树，不复制普通技能树。
{
  const rBase = { RQ1Base: [70,150,230], RQ2Base: [140,300,460], RWBase: [150,315,480], RE1Base: [70,150,230], RE2Base: [140,300,460] };
  const parameters = [];
  for (const [dataName, values] of Object.entries(rBase)) parameters.push(dataParam("leblanc_r", dataName, 1, values, dataName.toLowerCase().replace("base", "_base_damage"), `${dataName}基础魔法伤害`, "INTEGER", `客户端${dataName}取R技能等级索引1至3；不借用普通Q/W/E基础值。`, 10 + parameters.length * 10));
  parameters.push(dataFixedSeconds("leblanc_r", "RQMarkDuration", 1, 3.5, "mark_duration_ms", "复制Q魔印持续（毫秒）", "INTEGER", "客户端RQMarkDuration取索引1的3.5秒，转换为3500毫秒。", 70));
  parameters.push(dataFixed("leblanc_r", "RQ1RE1BaseAPRatio", 1, 0.4, "rq1_re1_ap_ratio", "复制Q/E首段法强比例", "DECIMAL", "RQ1Damage和RE1Damage共享RQ1RE1BaseAPRatio=0.4。", 80));
  parameters.push(calcFixed("leblanc_r", "RQ2Damage", 0.8, "rq2_ap_ratio", "复制Q二段法强比例", "DECIMAL", "RQ2Damage树的StatByCoefficient=0.8。", 90));
  parameters.push(calcFixed("leblanc_r", "RWDamage", 0.9, "rw_ap_ratio", "复制W法强比例", "DECIMAL", "RWDamage树的StatByCoefficient=0.9。", 100));
  parameters.push(calcFixed("leblanc_r", "RE2Damage", 0.85, "re2_ap_ratio", "复制E二段法强比例", "DECIMAL", "RE2Damage树的StatByCoefficient=0.85。", 110));
  parameters.push(levels("cooldown_ms", "故技重施基础冷却时间（毫秒）", "INTEGER", [45000,35000,25000], "当前R没有保护中的公共参数；官方16.17.1冷却数组等级1至3转换为毫秒。", 120));
  parameters.push(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("leblanc_r"), "当前根spellCastTime=0.425秒，转换为425毫秒。", 130));
  put("leblanc_r", parameters, [
    formula("replicated_q_initial_damage", "故技重施复制Q首段魔法伤害", add(P("rq1_base_damage"), mul(P("rq1_re1_ap_ratio"), ap)), "RQ1Damage = RQ1Base + 0.4×来源总法强。", 10),
    formula("replicated_q_mark_damage", "故技重施复制Q引爆魔法伤害", add(P("rq2_base_damage"), mul(P("rq2_ap_ratio"), ap)), "RQ2Damage = RQ2Base + 0.8×来源总法强。", 20),
    formula("replicated_w_damage", "故技重施复制W魔法伤害", add(P("rw_base_damage"), mul(P("rw_ap_ratio"), ap)), "RWDamage = RWBase + 0.9×来源总法强。", 30),
    formula("replicated_e_initial_damage", "故技重施复制E首段魔法伤害", add(P("re1_base_damage"), mul(P("rq1_re1_ap_ratio"), ap)), "RE1Damage = RE1Base + 0.4×来源总法强。", 40),
    formula("replicated_e_delayed_damage", "故技重施复制E延迟魔法伤害", add(P("re2_base_damage"), mul(P("re2_ap_ratio"), ap)), "RE2Damage = RE2Base + 0.85×来源总法强。", 50),
  ], [], [
    { kind: "时序", item: "上一技能选择、复制技能重施资格和两段时序", reason: "当前正文和五棵树明确数值，选择记忆与事件生产未接线。" },
  ], [{ kind: "范围", item: "乐芙兰分身自主技能", reason: "本批排除自主分身；R本体五棵复制树仍完整保留。" }], "R自身五棵当前计算树全部录入，按R技能等级1至3取值；不追加普通Q/W/E基础伤害。" );
}

// 薇古丝 P
{
  breakpoints("vex_p", "DoomCD", 25, [[6,-3],[11,-3],[16,-3]]);
  breakpoints("vex_p", "FearDuration", 0.75, [[6,0.25],[9,0.25],[13,0.25]]);
  const doom = [25,25,25,25,25,22,22,22,22,22,19,19,19,19,19,16,16,16];
  const fear = [0.75,0.75,0.75,0.75,0.75,1,1,1,1.25,1.25,1.25,1.25,1.5,1.5,1.5,1.5,1.5,1.5];
  put("vex_p", [
    charLevels("doom_cooldown_seconds_by_character_level", "终焉基础冷却（角色等级秒数）", "DECIMAL", doom, "DoomCD树：25秒起，角色等级6/11/16各减少3秒；按角色等级1至18保存明确阶梯。", 10),
    charLevels("fear_duration_seconds_by_character_level", "恐惧持续（角色等级秒数）", "DECIMAL", fear, "FearDuration树：0.75秒起，角色等级6/9/13各增加0.25秒。", 20),
    dataFixedSeconds("vex_p", "GloomDuration", 1, 6, "gloom_duration_ms", "暮气持续（毫秒）", "INTEGER", "客户端GloomDuration取索引1的6秒，转换为6000毫秒。", 30),
    runtime("actual_gloom_character_level_base_damage", "当前角色等级暮气基础伤害", "DECIMAL", "GloomProcCalc只有40至150角色等级插值端点，未证中间函数；无默认实际输入。", 40),
    dataFixed("vex_p", "APRatio", 1, 0.25, "gloom_ap_ratio", "暮气额外伤害法强比例", "DECIMAL", "GloomProcCalc的APRatio=0.25×来源总法强。", 50),
    dataFixed("vex_p", "GloomCDChamp", 1, 0.25, "gloom_champion_cooldown_refund_ratio", "英雄目标命中后终焉冷却返还比例", "DECIMAL", "当前正文消费GloomCDChamp=0.25；只保留英雄条件参数。", 60),
  ], [formula("gloom_bonus_magic_damage", "暮气额外魔法伤害", add(P("actual_gloom_character_level_base_damage"), mul(P("gloom_ap_ratio"), ap)), "GloomProcCalc = 当前角色等级暮气基础伤害输入 + 0.25×来源总法强；不猜40至150中间曲线。", 10)], [], [
    { kind: "输入", item: "actual_gloom_character_level_base_damage", reason: "角色等级插值中间值未证，缺值时拒绝求值。" },
    { kind: "时序", item: "冲刺标记、下一次攻击消费、恐惧和冷却返还", reason: "当前文本给出条件，自动触发与标记生命周期未接线。" },
  ], [{ kind: "范围", item: "非英雄GloomMinionMod/GloomCDNonChamp", reason: "兵线与野怪分支不进入本轮唯一敌方英雄范围。" }], "P采用25秒DoomCD与明确角色等级断点；GloomProcCalc只录无默认基础输入和已证法强项。" );
}

// 薇古丝 Q
{
  put("vex_q", [
    dataParam("vex_q", "BaseDamage", 1, [70,115,160,205,250], "base_damage", "基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5；索引0的25不是等级1。", 10),
    dataFixed("vex_q", "APRatio", 1, 0.7, "ap_ratio", "法强比例", "DECIMAL", "QDamageCalc消费APRatio=0.7×来源总法强。", 20),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("vex_q"), "当前根spellCastTime约0.15秒，按来源精度转换为150毫秒。", 30),
  ], [formula("magic_damage", "寒心波云魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "QDamageCalc = BaseDamage + APRatio×来源总法强；命中后消费暮气由事件接线。", 10)], [], [
    { kind: "时序", item: "飞行提速和暮气消费", reason: "当前正文明确命中消费，飞行与状态事件未接线。" },
  ], [], "只使用当前正文消费的QDamageCalc；匿名1.1乘数树没有当前正文消费者，不录为第二种伤害。" );
}

// 薇古丝 W
{
  put("vex_w", [
    dataParam("vex_w", "ShieldAmount", 1, [50,75,100,125,150], "base_shield", "基础护盾值", "INTEGER", "客户端ShieldAmount取索引1至5；索引0的25不是等级1。", 10),
    calcFixed("vex_w", "ShieldCalc", 0.75, "shield_ap_ratio", "护盾法强比例", "DECIMAL", "ShieldCalc树的StatByCoefficient=0.75×来源总法强。", 20),
    dataParam("vex_w", "BaseDamage", 1, [80,120,160,200,240], "base_damage", "基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5；索引0的40不是等级1。", 30),
    dataFixed("vex_w", "DamageAPRatio", 1, 0.3, "damage_ap_ratio", "伤害法强比例", "DECIMAL", "WDamageCalc消费DamageAPRatio=0.3×来源总法强。", 40),
    dataFixedSeconds("vex_w", "ShieldDuration", 1, 2.5, "shield_duration_ms", "护盾持续（毫秒）", "INTEGER", "客户端ShieldDuration取索引1的2.5秒，转换为2500毫秒。", 50),
    dataFixed("vex_w", "AOERadius", 1, 475, "aoe_radius", "冲击波范围半径", "INTEGER", "客户端AOERadius取索引1。", 60),
    dataFixed("vex_w", "BonusAOERadiusVsDashes", 1, 75, "bonus_aoe_radius_vs_dashes", "针对位移目标的额外范围", "INTEGER", "客户端BonusAOERadiusVsDashes取索引1；条件事件待接。", 70),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("vex_w"), "当前根spellCastTime=0.25秒，转换为250毫秒。", 80),
  ], [
    formula("shield_value", "生人勿近自身护盾值", add(P("base_shield"), mul(P("shield_ap_ratio"), ap)), "ShieldCalc = ShieldAmount + 0.75×来源总法强。", 10),
    formula("magic_damage", "生人勿近唯一敌人魔法伤害", add(P("base_damage"), mul(P("damage_ap_ratio"), ap)), "WDamageCalc = BaseDamage + DamageAPRatio×来源总法强。", 20),
  ], [normalShield("self_shield", "生人勿近自身护盾", "shield_value", "shield_duration_ms", null, "当前正文明确自身护盾，普通护盾吸收类型未限定；命中与暮气消费事件未接线。", 10)], [
    { kind: "时序", item: "护盾应用、冲击波命中和暮气消费", reason: "树给出数值，实际命中与状态消费未接线。" },
  ], [{ kind: "范围", item: "冲刺目标额外范围", reason: "只保留来源参数，不把条件额外范围扩成自动命中事件。" }], "W同时保留ShieldCalc、WDamageCalc和普通自身护盾生命周期；不创建伤害结果。" );
}

// 薇古丝 E
{
  put("vex_e", [
    dataParam("vex_e", "BaseDamage", 1, [50,70,90,110,130], "base_damage", "基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至5；索引0的30不是等级1。", 10),
    dataParam("vex_e", "APRatio", 1, [0.4,0.45,0.5,0.55,0.6], "ap_ratio", "法强比例", "DECIMAL", "客户端APRatio取索引1至5，EDamageCalc按技能等级消费。", 20),
    dataParam("vex_e", "SlowAmount", 1, [0.3,0.35,0.4,0.45,0.5], "slow_ratio", "减速比例", "DECIMAL", "客户端SlowAmount取索引1至5的比例值；当前正文按SlowAmount×100显示百分数。", 30),
    dataFixedSeconds("vex_e", "SlowDuration", 1, 2, "slow_duration_ms", "减速持续（毫秒）", "INTEGER", "客户端SlowDuration取索引1的2秒，转换为2000毫秒。", 40),
    dataFixed("vex_e", "StartingRadius", 1, 200, "starting_radius", "初始范围半径", "INTEGER", "客户端StartingRadius取索引1。", 50),
    dataFixed("vex_e", "RadiusGrowthRate", 1, 13, "radius_growth_rate", "范围增长率", "INTEGER", "客户端RadiusGrowthRate取索引1；增长时序待接。", 60),
    dataFixed("vex_e", "MaxRadius", 1, 300, "max_radius", "最大范围半径", "INTEGER", "客户端MaxRadius取索引1。", 70),
    dataFixed("vex_e", "GloomCDChampTooltip", 1, 0.25, "gloom_champion_cooldown_refund_ratio", "击杀英雄后终焉冷却返还比例", "DECIMAL", "当前正文扩展消费GloomCDChampTooltip=0.25；仅英雄击杀条件。", 80),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("vex_e"), "当前根spellCastTime=0.25秒，转换为250毫秒。", 90),
  ], [formula("magic_damage", "溟濛渐染唯一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "EDamageCalc = BaseDamage + APRatio×来源总法强。", 10)], [], [
    { kind: "时序", item: "范围成长、减速、暮气施加和击杀返还", reason: "当前文本与参数明确数值，实际区域事件未接线。" },
  ], [{ kind: "范围", item: "非英雄击杀返还", reason: "GloomCDNonChampTooltip与非英雄分支不进入本轮唯一敌方英雄候选。" }], "E保留当前正文消费的EDamageCalc、减速端点与英雄击杀返还参数，不把非英雄返还混入。" );
}

// 薇古丝 R
{
  put("vex_r", [
    dataParam("vex_r", "BaseDamage", 1, [75,125,175], "base_damage", "首次基础魔法伤害", "INTEGER", "客户端BaseDamage取索引1至3；索引0的25不是等级1。", 10),
    calcFixed("vex_r", "RDamageCalc", 0.2, "first_ap_ratio", "首次伤害法强比例", "DECIMAL", "RDamageCalc树的StatByCoefficient=0.2×来源总法强。", 20),
    dataParam("vex_r", "RecastDamage", 1, [150,250,350], "recast_base_damage", "重施基础魔法伤害", "INTEGER", "客户端RecastDamage取索引1至3；索引0的50不是等级1。", 30),
    calcFixed("vex_r", "RecastDamageCalc", 0.5, "recast_ap_ratio", "重施伤害法强比例", "DECIMAL", "RecastDamageCalc树的StatByCoefficient=0.5×来源总法强。", 40),
    dataFixedSeconds("vex_r", "R2Duration", 1, 4, "recast_window_ms", "标记与重施窗口（毫秒）", "INTEGER", "客户端R2Duration取索引1的4秒，转换为4000毫秒。", 50),
    dataFixedSeconds("vex_r", "TakedownWindow", 1, 8, "takedown_window_ms", "击杀判定窗口（毫秒）", "INTEGER", "客户端TakedownWindow取索引1的8秒，转换为8000毫秒。", 60),
    dataFixedSeconds("vex_r", "ResetWindow", 1, 12, "reset_window_ms", "冷却暂时重置窗口（毫秒）", "INTEGER", "客户端ResetWindow取索引1的12秒，转换为12000毫秒。", 70),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("vex_r"), "当前根spellCastTime=0.25秒，转换为250毫秒。", 80),
  ], [
    formula("first_magic_damage", "愁煞首次魔法伤害", add(P("base_damage"), mul(P("first_ap_ratio"), ap)), "RDamageCalc = BaseDamage + 0.2×来源总法强。", 10),
    formula("recast_magic_damage", "愁煞重施魔法伤害", add(P("recast_base_damage"), mul(P("recast_ap_ratio"), ap)), "RecastDamageCalc = RecastDamage + 0.5×来源总法强。", 20),
  ], [], [
    { kind: "时序", item: "首次标记、重施冲刺、击杀重置", reason: "当前正文给出4/8/12秒窗口，事件资格与时点未接线。" },
  ], [{ kind: "范围", item: "首个敌方英雄以外的目标", reason: "当前正文限定首个命中的敌方英雄。" }], "R首次和重施两棵当前树分别保存，保留同一目标两段伤害及三个窗口参数。" );
}

// 基兰 P：用户明确排除经验/金币，本轮只保留主体保护，不新增组成。
put("zilean_p", [], [], [], [
  { kind: "范围", item: "经验获取、经验传授和经验计数", reason: "用户明确排除经验/金币；当前主体和空组成保护，不生成参数、公式或事件。" },
], [], "基兰P整槽属于本轮明确排除范围；不把源树XPPer5或经验计数转成技能数据。" );

// 基兰 Q
{
  put("zilean_q", [
    dataParam("zilean_q", "BombBaseDamage", 1, [75,115,165,230,300], "base_damage", "基础魔法伤害", "INTEGER", "客户端BombBaseDamage取索引1至5；索引0的30不是等级1。", 10),
    dataFixed("zilean_q", "APRatio", 1, 0.9, "ap_ratio", "法强比例", "DECIMAL", "TotalDamage树消费APRatio=0.9×来源总法强。", 20),
    dataParamSeconds("zilean_q", "StunDuration", 1, [1.1,1.2,1.3,1.4,1.5], "stun_duration_ms", "晕眩持续（毫秒）", "INTEGER", "客户端StunDuration取索引1至5，秒转毫秒。", 30),
    dataFixedSeconds("zilean_q", "FuseDuration", 1, 3, "fuse_duration_ms", "炸弹引爆时间（毫秒）", "INTEGER", "客户端FuseDuration取索引1的3秒，转换为3000毫秒。", 40),
    fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", spellCastMs("zilean_q"), "当前根spellCastTime=0；mCastTime另有0.25秒来源字段，保留冲突说明。", 50),
  ], [formula("magic_damage", "定时炸弹魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), ap)), "TotalDamage = BombBaseDamage + APRatio×来源总法强；同一目标Q-W-Q的双炸由事件层决定。", 10)], [], [
    { kind: "时序", item: "附着、3秒引爆和Q-W-Q双炸", reason: "正文明确同一目标第二颗炸弹提前引爆第一颗；事件顺序未接线。" },
    { kind: "输入", item: "mCastTime与spellCastTime", reason: "当前根字段分别为0.25秒和0；候选只采用spellCastTime并保留冲突证据。" },
  ], [], "Q只录当前TotalDamage树和同目标双炸的数值载体，不创建自动晕眩结果。" );
}

// 基兰 W
{
  put("zilean_w", [
    dataFixedSeconds("zilean_w", "CooldownReduction", 1, 10, "cooldown_reduction_ms", "其它基础技能冷却缩短（毫秒）", "INTEGER", "客户端CooldownReduction取索引1的10秒，转换为10000毫秒；当前正文限定其它基础技能。", 10),
    fixed("cast_time_seconds", "施法时间（秒）", "DECIMAL", spellCastSeconds("zilean_w", 0.5182999968528748), "当前根spellCastTime原值约0.5183秒，因毫秒换算不是整数，保留来源秒单位。", 20),
  ], [], [], [
    { kind: "时序", item: "W对Q/E的冷却联动", reason: "当前正文明确10秒数值，实际冷却变更时点未接线；不把W自身或R加入效果。" },
    { kind: "资源", item: "mDoesNotConsumeMana与公共法力", reason: "当前根有mDoesNotConsumeMana=true且公共法力值受保护，候选不重建或强行创建扣费结果。" },
  ], [], "W只保存当前正文消费的10秒减冷却数值和根施法时间；公共冷却/法力参数只复用保护值。" );
}

// 基兰 E
{
  put("zilean_e", [
    dataFixedSeconds("zilean_e", "Duration", 1, 2.5, "duration_ms", "移速效果持续（毫秒）", "INTEGER", "客户端Duration取索引1的2.5秒，转换为2500毫秒。", 10),
    dataParam("zilean_e", "SpeedAmount", 1, [40,55,70,85,99], "speed_percent_points", "移动速度百分数点", "INTEGER", "客户端SpeedAmount取技能等级索引1至5；索引0的25不是等级1。", 20),
    fixed("cast_time_seconds", "施法时间（秒）", "DECIMAL", spellCastSeconds("zilean_e", 0.515250027179718), "当前根spellCastTime原值约0.51525秒，因毫秒换算不是整数，保留来源秒单位。", 30),
  ], [], [], [
    { kind: "目标资格", item: "自身是否属于友方可选目标", reason: "正文同时给出友方加速和敌方减速；本轮不自动把友方分支接成自身效果。" },
    { kind: "时序", item: "减速/加速实际应用", reason: "数值和持续时间有来源，目标选择与应用事件未接线。" },
  ], [{ kind: "范围", item: "纯其他友军收益", reason: "本轮唯一敌方范围不生成第三方友军效果；自身资格保留为待核。" }], "E保留当前正文的敌方减速/友方加速数值，未猜自身施放资格。" );
}

// 基兰 R
{
  put("zilean_r", [
    dataParam("zilean_r", "RBaseHeal", 1, [600,850,1100], "base_heal", "复活基础治疗量", "INTEGER", "客户端RBaseHeal取索引1至3；索引0的350不是等级1。", 10),
    dataFixed("zilean_r", "APRatio", 1, 2, "ap_ratio", "法强比例", "DECIMAL", "RTotalHeal树消费APRatio=2×来源总法强。", 20),
    dataFixedSeconds("zilean_r", "RDuration", 1, 5, "protection_duration_ms", "保护符文持续（毫秒）", "INTEGER", "客户端RDuration取索引1的5秒，转换为5000毫秒。", 30),
    dataFixedSeconds("zilean_r", "ReviveStateDuration", 1, 3, "revive_stasis_duration_ms", "复活凝滞持续（毫秒）", "INTEGER", "客户端ReviveStateDuration取索引1的3秒，转换为3000毫秒。", 40),
    fixed("cast_time_seconds", "施法时间（秒）", "DECIMAL", spellCastSeconds("zilean_r", 0.5182999968528748), "当前根spellCastTime原值约0.5183秒，因毫秒换算不是整数，保留来源秒单位。", 50),
  ], [formula("revive_heal", "时光倒流复活治疗量", add(P("base_heal"), mul(P("ap_ratio"), ap)), "RTotalHeal = RBaseHeal + 2×来源总法强；治疗应用时点和自身资格待接。", 10)], [], [
    { kind: "目标资格", item: "自身复活是否可选", reason: "本轮保留自身收益数值，但当前正文只明确友方英雄，未把自身资格当已证。" },
    { kind: "时序", item: "5秒保护、死亡、3秒凝滞和治疗", reason: "当前正文给出状态时长，真实触发与治疗时点未接线。" },
  ], [{ kind: "范围", item: "纯其他友军复活结果", reason: "本轮不创建第三方友军直接结果；保留R主体数值和自身待核路径。" }], "R将治疗、保护时间和凝滞时间分开保存；普通友方资格和自身资格不混为已接线事件。" );
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
  for (const [key, endpoint] of [["parameters","parameters"],["formulas","formulas"],["effects","effects"],["processes","processes"],["internalStates","internal-states"],["triggerRules","trigger-rules"]]) {
    const entry = snapshotByRoute.get(`/skills/${skillKey}/${endpoint}`); assert(entry?.status === 200 && Array.isArray(entry.data), "组成列表保护缺失", { skillKey, endpoint });
    result[key] = { status: entry.status, count: entry.data.length, dataSha256: sha256(JSON.stringify(entry.data)) };
  }
  const image = snapshotByRoute.get(`/skills/${skillKey}/representative-image`); assert(image?.status === 200, "代表图保护缺失", skillKey);
  result.representativeImage = { status: image.status, dataSha256: sha256(JSON.stringify(image.data)) };
  return result;
}

const reusedPublicParameters = publicReuse.map(item => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false }));
const reusedSet = new Set(reusedPublicParameters.map(item => `${item.skillKey}|${item.parameterKey}`));
assert(reusedSet.size === 26, "公共参数重复", reusedPublicParameters);
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
    subjectWrite: { planned: false, reason: `主体、分类、图片和现有组成保护快照；当前候选只计划新增组成。现有分类=${JSON.stringify(subject.skillCategoryKeys)}，来源技能槽=${slot === "P" ? "passive" : "common"}。` },
    source: sourceRecord(skillKey), write: writes[skillKey], pending: pending[skillKey], excluded: excluded[skillKey], sourceProof: proofs[skillKey], currentProtection: componentProtection(skillKey),
  };
}

const counts = { skills: order.length, parameters: order.reduce((n, k) => n + skills[k].write.parameters.length, 0), formulas: order.reduce((n, k) => n + skills[k].write.formulas.length, 0), effects: order.reduce((n, k) => n + skills[k].write.effects.length, 0), processes: 0, internalStates: 0, triggerRules: 0 };
assert(counts.skills === 20 && counts.formulas > 0, "候选计数不符", counts);
function walkExpression(node, skillKey, pathText = "expression") {
  assert(node && typeof node === "object", "公式节点不是对象", { skillKey, pathText });
  if (node.nodeType === "PARAMETER") { assert(skills[skillKey].write.parameters.some(p => p.parameterKey === node.parameterKey) || reusedSet.has(`${skillKey}|${node.parameterKey}`), "公式参数引用未定义", { skillKey, node }); return; }
  if (node.nodeType === "ATTRIBUTE") { assert(["SOURCE","TARGET"].includes(node.attributeOwner), "公式属性所有者非法", node); assert(["TOTAL","BASE","BONUS","CURRENT","MISSING","CURRENT_RATIO","MISSING_RATIO"].includes(node.attributeValueKind), "公式属性取值种类非法", node); assert(attributeKeys.has(node.attributeKey), "公式属性键不在保护字典", node); return; }
  assert(node.nodeType === "OPERATION" && ["ADD","SUBTRACT","MULTIPLY","DIVIDE","MIN","MAX"].includes(node.operation), "公式操作非法", node);
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
  protectedCharacters: ["champion_katarina","champion_leblanc","champion_vex","champion_zilean"], protectedCharacterRelations: ["champion_katarina","champion_leblanc","champion_vex","champion_zilean"],
  protectedCatalogs: ["/attributes","/skill-categories","/modifier-zones","/damage-types"], publicParameterDetails: reusedPublicParameters.length, nonPublicExisting: inputVersion.nonPublicExisting,
};
const sourceVersion = { clientVersion: inputVersion.clientVersion, officialVersion: inputVersion.officialVersion, build: "16.17.8104348+branch.releases-16-17.content.release" };
const sourceReview = { conclusionFile: ".agents/artifacts/hero34-cursor-review-run-20260910/Cursor来源复核结论.md", conclusionSha256: sha256File(cursorReviewPath), auditFile: ".agents/artifacts/hero34-cursor-review-run-20260910/主负责人执行审计.json", auditSha256: sha256File(cursorAuditPath), verdict: "READY", runId: cursorAudit.runId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, apiWrites: cursorAudit.apiWrites, gitDelta: cursorAudit.gitDelta };

const sourceRange = {
  generatedAt, batch, revision: "hero34-source-v1-candidate", status: "候选范围说明；未调用业务接口",
  sourceVersion, inputPackage: ".agents/artifacts/hero34-root-entry-20260910", sourceBindingSha256: sha256File(bindingPath), inputVersionSha256: sha256File(inputVersionPath),
  rootReviewSha256: sha256File(rootReviewPath), semanticNoteSha256: sha256File(semanticNotePath), cursorReviewSha256: sourceReview.conclusionSha256,
  categories: ["当前正文和树可录确定值", "一对一无关分支", "属性/目标/时序/曲线待核"],
  perSkill: Object.fromEntries(order.map(k => ({ key: k, value: { recordable: skills[k].write.parameters.map(p => p.parameterKey).concat(skills[k].write.formulas.map(f => f.formulaKey)), pending: pending[k], excluded: excluded[k] } })).map(x => [x.key, x.value])),
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
  meta: { generatedAt, batch, revision: "hero34-source-v1-candidate", status: "候选已生成，等待主负责人审查；未调用业务接口", gameId: "lol", apiBase, sourceVersion, sourcePolicy: "固定客户端16.17、官方16.17.1、当前mLocKeys绑定正文和当前计算树；明确值才进入候选，未知实际输入、时序、目标资格和曲线不猜、不设默认。", scope: "卡特琳娜、乐芙兰、薇古丝、基兰20个技能槽；唯一敌方英雄一对一。基兰P经验/金币整槽排除；乐芙兰R五棵复制树、卡特琳娜匕首与R同目标多次、薇古丝R两段、基兰Q同目标双炸保留。", sourceBindingSha256: sha256File(bindingPath), sourceRangeSha256: sha256(sourceRangeBytes), rootReviewSha256: sha256File(rootReviewPath), semanticNoteSha256: sha256File(semanticNotePath), sourceReview, inputPackage: ".agents/artifacts/hero34-root-entry-20260910", protectionSnapshotSha256: sha256File(protectionPath), publicReuseSha256: sha256File(publicReusePath), sourceIndexSha256: inputVersion.sourceIndexSha256, currentGETs: protection.GETs, apiCalls: 0, businessWrites: 0, tokenStored: false, candidateSha256: null },
  order, skills, reusedPublicParameters, publicVerification, protectedSummary, counts, requestCount: counts.parameters + counts.formulas + counts.effects, sourceFiles: inputIntegrity,
  sourceNotes: { katarina: "P完整角色等级曲线和AP断点；E冷却缩减保留角色等级比例、实际冷却倍率与DataCooldown；R魔法/物理两棵总量保留攻速项。", leblanc: "P只保留本体保护；R自身五棵RQ1/RQ2/RW/RE1/RE2树按R等级保存，不叠普通Q/W/E。", vex: "P使用25秒DoomCD与恐惧断点，GloomProcCalc中间曲线无默认；Q/W/E消费/施加暮气条件分开。", zilean: "P因经验/金币范围明确排除；Q同目标双炸、W减Q/E冷却、E/R自身待核数值保留。", indices: "DataValues技能等级按当前绑定逐字段核对；普通技能占位数组使用索引1起；官方冷却和法力只用于26项公共复用校验。", attributes: "公式节点使用attributeOwner/attributeKey/attributeValueKind；mStat选择器只在已有窄证处映射，其余改实际输入。" }, apiWrites: 0,
};
const candidateBytesWithoutHash = JSON.stringify(candidate, null, 2) + "\n";
candidate.meta.candidateSha256 = sha256(candidateBytesWithoutHash);
const candidateBytes = JSON.stringify(candidate, null, 2) + "\n";

const requests = []; let sequence = 0;
for (const skillKey of order) for (const [kind, identityKey, routeKind] of [["parameters","parameterKey","parameters"],["formulas","formulaKey","formulas"],["effects","effectKey","effects"],["processes","processKey","processes"],["internalStates","stateKey","internal-states"],["triggerRules","ruleKey","trigger-rules"]]) for (const body of skills[skillKey].write[kind]) {
  sequence += 1; const stableKey = body[identityKey]; requests.push({ sequence, method: "POST", route: `/skills/${skillKey}/${routeKind}`, detailRoute: `/skills/${skillKey}/${routeKind}/${stableKey}`, skillKey, kind, stableKey, status: "仅意图，未调用", body });
}
assert(requests.length === candidate.requestCount, "请求数量不符", { requests: requests.length, expected: candidate.requestCount });
const protectedRoutes = ["/attributes","/skill-categories","/modifier-zones","/damage-types", ...protectedSummary.protectedCharacters.flatMap(key => [`/characters/${key}`, `/character-skill-relations?characterKey=${key}`]), ...order.flatMap(key => [`/skills/${key}`,`/skills/${key}/representative-image`,`/skills/${key}/parameters`,`/skills/${key}/formulas`,`/skills/${key}/effects`,`/skills/${key}/processes`,`/skills/${key}/internal-states`,`/skills/${key}/trigger-rules`])];
const plan = { generatedAt, status: "仅写入意图，未调用业务接口", batch, revision: "hero34-source-v1-candidate", apiBase, sourceVersion, candidateSha256: sha256(candidateBytes), sourceBindingSha256: sha256File(bindingPath), sourceRangeSha256: sha256(sourceRangeBytes), protectionSnapshotSha256: sha256File(protectionPath), publicReuseSha256: sha256File(publicReusePath), requestCount: requests.length, counts, reusedPublicParameters, publicVerification, protectedRoutes, protectedSummary, requests, noApiCalls: true, apiWrites: 0 };
const planBytes = JSON.stringify(plan, null, 2) + "\n";

writeText(path.join(artifactDir, "完整候选.json"), candidateBytes);
writeText(path.join(artifactDir, "请求计划.json"), planBytes);
writeText(path.join(artifactDir, "来源值摘要.json"), sourceValuesBytes);
writeText(path.join(artifactDir, "来源与范围.json"), sourceRangeBytes);
writeJson(path.join(artifactDir, "候选版本.json"), { generatedAt, batch, revision: "hero34-source-v1-candidate", sourceVersion, counts, requestCount: requests.length, publicReuse: reusedPublicParameters.length, candidateSha256: sha256(candidateBytes), planSha256: sha256(planBytes), sourceValuesSha256: sha256(sourceValuesBytes), sourceRangeSha256: sha256(sourceRangeBytes), strictMath: "独立数学核算.mjs", strictMathStatus: "待执行", businessWrites: 0, apiCalls: 0, protectedSummary, noApiCalls: true });
writeJson(path.join(artifactDir, "来源哈希汇总.json"), { generatedAt, batch, inputPackage: ".agents/artifacts/hero34-root-entry-20260910", inputIntegrity, frozen: { inputVersionSha256: sha256File(inputVersionPath), bindingSha256: sha256File(bindingPath), protectionSha256: sha256File(protectionPath), publicReuseSha256: sha256File(publicReusePath), interfaceSampleSha256: sha256File(interfaceSamplePath), attributeBoundarySha256: sha256File(attributeBoundaryPath), semanticNoteSha256: sha256File(semanticNotePath), rootReviewSha256: sha256File(rootReviewPath) }, cursorReview: sourceReview, outputs: { candidateSha256: sha256(candidateBytes), planSha256: sha256(planBytes), sourceValuesSha256: sha256(sourceValuesBytes), sourceRangeSha256: sha256(sourceRangeBytes) }, apiWrites: 0 });
const readme = `# 第三十四批候选\n\n本目录保存卡特琳娜、乐芙兰、薇古丝、基兰20个技能槽的静态候选和请求意图。输入固定客户端16.17、官方资料16.17.1、当前绑定正文及计算树；输入保护快照198次GET、业务写入为0，Cursor来源复核为READY。\n\n候选只新增当前空组成中的参数、公式和一个明确的自身普通护盾效果；26项已有公共冷却/法力参数只复用，不更新或重建。主体、代表图、角色与关系、六类组成列表及已有详情均在候选中保留保护摘要。\n\n所有普通技能等级数组按来源实际索引核对，毫秒参数保持整数；角色等级断点使用角色等级模式，未证的属性选择器、曲线、目标资格和时序使用无默认实际输入或列为待核。公式节点严格二元。\n\n范围边界：基兰P的经验与经验传授按用户要求整槽排除；乐芙兰R保留五棵本体复制树；卡特琳娜匕首和死亡莲华同一目标多次伤害、薇古丝愁煞两段、基兰同目标双炸均只保存数值载体，未创建自动事件。\n\n完整候选、请求计划、来源值摘要、来源与范围和独立数学脚本均为候选阶段文件，不代表业务入库、页面验收或战斗运行。\n`;
writeText(path.join(artifactDir, "README.md"), readme);
for (const file of ["完整候选.json","请求计划.json","来源值摘要.json","来源与范围.json","候选版本.json","来源哈希汇总.json","README.md"]) { fs.mkdirSync(durableDir, { recursive: true }); fs.copyFileSync(path.join(artifactDir, file), path.join(durableDir, file)); }

console.log(JSON.stringify({ batch, generatedAt, counts, requestCount: requests.length, candidateSha256: sha256(candidateBytes), planSha256: sha256(planBytes), sourceValuesSha256: sha256(sourceValuesBytes), sourceRangeSha256: sha256(sourceRangeBytes), apiWrites: 0 }, null, 2));
