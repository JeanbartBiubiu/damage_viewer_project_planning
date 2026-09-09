import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repo = "C:/project/damage_web_dev";
const inputDir = path.join(repo, ".agents/artifacts/hero31-root-entry-20260909");
const durableDir = path.join(repo, "数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十一批");
const batch = "英雄机制第三十一批";
const apiBase = "http://127.0.0.1:8080/api/admin/games/lol";
const generatedAt = new Date().toISOString();

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const sha256File = file => sha256(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const close = (a, b, tolerance = 1e-6) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && Math.abs(Number(a) - Number(b)) <= tolerance * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
const clean = value => {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return Math.round(value * 1e6) / 1e6;
};
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
const sourceBindingPath = path.join(inputDir, "来源绑定与当前文本.json");
const sourceRangePath = path.join(inputDir, "来源与范围.json");
const frozenManifestPath = path.join(inputDir, "来源冻结清单.json");
const protectionPath = path.join(inputDir, "参考资料", "当前20槽保护快照.json");
const publicReusePath = path.join(inputDir, "参考资料", "公共参数复用清单.json");
const semanticEvidencePath = path.join(inputDir, "参考资料", "候选前关键语义核对证据.json");
const semanticNotePath = path.join(inputDir, "候选前关键语义核对.md");
const cursorReviewDir = path.join(repo, ".agents/artifacts/hero31-cursor-review-run-20260909");
const cursorReviewPath = path.join(cursorReviewDir, "Cursor来源复核结论.md");
const cursorAuditPath = path.join(cursorReviewDir, "主负责人执行审计.json");

const inputVersion = readJson(inputVersionPath);
const source = readJson(sourceBindingPath);
const sourceRange = readJson(sourceRangePath);
const frozenManifest = readJson(frozenManifestPath);
const protection = readJson(protectionPath);
const publicReuse = readJson(publicReusePath);
const semanticEvidence = readJson(semanticEvidencePath);
const cursorAudit = readJson(cursorAuditPath);
const cursorReviewText = fs.readFileSync(cursorReviewPath, "utf8");

assert(inputVersion.clientVersion === "16.17" && inputVersion.officialVersion === "16.17.1", "来源版本不符");
assert(inputVersion.GETs === 201 && inputVersion.apiWrites === 0, "冻结输入包GET/写入计数不符", inputVersion);
assert(protection.GETs === 201 && protection.apiWrites === 0 && protection.businessWrites === 0, "保护快照不是只读201 GET", protection);
assert(Array.isArray(publicReuse) && publicReuse.length === 29, "公共参数复用数量不是29", publicReuse.length);
assert(cursorReviewText.includes("VERDICT: READY"), "Cursor来源复核不是READY");
assert(cursorAudit.readonlyAuditPassed === true && cursorAudit.apiWrites === 0 && Array.isArray(cursorAudit.gitDelta) && cursorAudit.gitDelta.length === 0, "Cursor只读审计不满足", cursorAudit);

const expectedInputVersionSha = frozenManifest.sourceInputSha256;
const expectedSourceBindingSha = frozenManifest.sourceBindingSha256;
const expectedSourceRangeSha = frozenManifest.sourceRangeSha256;
assert(sha256File(inputVersionPath) === expectedInputVersionSha, "输入版本字节已漂移");
assert(sha256File(sourceBindingPath) === expectedSourceBindingSha, "来源绑定字节已漂移");
assert(sha256File(sourceRangePath) === expectedSourceRangeSha, "来源范围字节已漂移");
assert(sha256File(protectionPath) === frozenManifest.protectionSnapshotSha256, "保护快照字节已漂移");
assert(sha256File(publicReusePath) === frozenManifest.publicReuseSha256, "公共参数清单字节已漂移");

const inputIntegrity = {};
const frozenHashes = frozenManifest.generatedInputHashes ?? inputVersion.generatedInputHashes ?? {};
for (const [relative, expected] of Object.entries(frozenHashes)) {
  const file = path.join(inputDir, relative);
  assert(fs.existsSync(file), "冻结来源文件缺失", relative);
  const actual = sha256File(file);
  assert(actual === expected, "冻结来源文件字节已漂移", { relative, expected, actual });
  inputIntegrity[relative] = { expected, actual, byteSize: fs.statSync(file).size };
}

const sourceReview = {
  conclusionFile: ".agents/artifacts/hero31-cursor-review-run-20260909/Cursor来源复核结论.md",
  conclusionSha256: sha256File(cursorReviewPath),
  auditFile: ".agents/artifacts/hero31-cursor-review-run-20260909/主负责人执行审计.json",
  auditSha256: sha256File(cursorAuditPath),
  verdict: "READY",
  runId: cursorAudit.runId,
  events: cursorAudit.events,
  uniqueTools: cursorAudit.uniqueTools,
  apiWrites: cursorAudit.apiWrites,
  gitDelta: cursorAudit.gitDelta,
};

const heroIdByKey = {
  champion_janna: "Janna",
  champion_lulu: "Lulu",
  champion_nami: "Nami",
  champion_morgana: "Morgana",
};
const officialSpellIndex = { Q: 0, W: 1, E: 2, R: 3 };
const order = [
  "janna_p", "janna_q", "janna_w", "janna_e", "janna_r",
  "lulu_p", "lulu_q", "lulu_w", "lulu_e", "lulu_r",
  "nami_p", "nami_q", "nami_w", "nami_e", "nami_r",
  "morgana_p", "morgana_q", "morgana_w", "morgana_e", "morgana_r",
];
const slotOf = skillKey => skillKey.slice(-1).toUpperCase();
const heroKeyOf = skillKey => `champion_${skillKey.split("_")[0]}`;
const sourceHeroOf = skillKey => source.heroes.find(hero => hero.key === heroKeyOf(skillKey));
const sourceSkillOf = skillKey => sourceHeroOf(skillKey)?.skills.find(skill => skill.skillKey === skillKey);
const sourceSummaryOf = skillKey => sourceHeroOf(skillKey)?.source.skills.find(skill => skill.slot === slotOf(skillKey));
const sourceSpellOf = skillKey => sourceSkillOf(skillKey)?.object?.mSpell;
const sourceOfficialOf = (heroId, slot) => {
  const file = path.join(inputDir, "参考资料", "官方中文", `${heroId}.json`);
  const data = readJson(file).data[heroId];
  return slot === "P" ? data.passive : data.spells[officialSpellIndex[slot]];
};
const sourceOfficialEnOf = (heroId, slot) => {
  const file = path.join(inputDir, "参考资料", "官方英文", `${heroId}.json`);
  const data = readJson(file).data[heroId];
  return slot === "P" ? data.passive : data.spells[officialSpellIndex[slot]];
};

for (const skillKey of order) {
  assert(sourceHeroOf(skillKey) && sourceSkillOf(skillKey) && sourceSummaryOf(skillKey) && sourceSpellOf(skillKey), "来源绑定技能缺失", skillKey);
  assert(sourceSummaryOf(skillKey).officialMaxRank >= 1, "技能等级上限缺失", skillKey);
  assert(sourceSummaryOf(skillKey).bindingAvailable === true, "来源绑定不可用", skillKey);
}

const snapshotByRoute = new Map((protection.requests ?? []).map(item => [item.route, item]));
const categoryCatalog = snapshotByRoute.get("/skill-categories")?.data?.items ?? [];
const categoryKeys = new Set(categoryCatalog.filter(item => item.status === "ENABLED").map(item => item.skillCategoryKey));
assert(categoryKeys.has("passive") && categoryKeys.has("common"), "技能分类字典缺少passive/common", categoryCatalog);
const attributeCatalog = snapshotByRoute.get("/attributes")?.data?.items ?? [];
const attributeKeys = new Set(attributeCatalog.filter(item => item.status === "ENABLED").map(item => item.attributeKey));
for (const key of ["ability_power", "move_speed_percent", "attack_damage", "attack_speed", "bonus_attack_speed_percent", "hp", "mana"]) {
  assert(attributeKeys.has(key), "属性字典缺少候选需要的键", key);
}
const modifierCatalog = snapshotByRoute.get("/modifier-zones")?.data?.items ?? [];
assert(modifierCatalog.some(item => item.status === "ENABLED" && item.modifierZoneKey === "attribute_flat_add"), "修正区域缺少attribute_flat_add");

const selectedTrace = Object.fromEntries(order.map(skillKey => [skillKey, {}]));
function row(skillKey, dataName) {
  const value = sourceSpellOf(skillKey)?.DataValues?.find(item => item.name === dataName);
  assert(value && Array.isArray(value.values), "DataValues缺失", { skillKey, dataName });
  return value;
}
function selected(skillKey, dataName, sourceIndexStart, expected) {
  const values = row(skillKey, dataName).values;
  const actual = expected.map((_, index) => values[sourceIndexStart + index]);
  assert(actual.every(value => typeof value === "number" && Number.isFinite(value)), "来源等级值缺失", { skillKey, dataName, sourceIndexStart, actual });
  assert(actual.length === expected.length && actual.every((value, index) => close(value, expected[index])), "来源等级索引或数值不符", {
    skillKey, dataName, sourceIndexStart, actual, expected,
  });
  const normalized = actual.map(clean);
  selectedTrace[skillKey][dataName] = {
    sourceDataIndices: actual.map((_, index) => sourceIndexStart + index),
    sourceValues: actual,
    normalizedValues: normalized,
  };
  return normalized;
}
function dataScalar(skillKey, dataName, sourceIndex, expected) {
  return selected(skillKey, dataName, sourceIndex, [expected])[0];
}
function calculation(skillKey, name) {
  const value = sourceSpellOf(skillKey)?.mSpellCalculations?.[name];
  assert(value, "计算树缺失", { skillKey, name });
  return value;
}
function findNumbers(value, result = []) {
  if (typeof value === "number" && Number.isFinite(value)) result.push(value);
  else if (Array.isArray(value)) value.forEach(child => findNumbers(child, result));
  else if (value && typeof value === "object") Object.values(value).forEach(child => findNumbers(child, result));
  return result;
}
function calculationCoefficient(skillKey, name, expected) {
  const calc = calculation(skillKey, name);
  const values = [];
  const walk = value => {
    if (!value || typeof value !== "object") return;
    if (typeof value.mCoefficient === "number") values.push(value.mCoefficient);
    if (typeof value.mNumber === "number") values.push(value.mNumber);
    Object.values(value).forEach(walk);
  };
  walk(calc);
  assert(values.some(value => close(value, expected)), "计算树系数不符", { skillKey, name, values, expected });
  return clean(expected);
}
function calculationMultiplier(skillKey, name, expected) {
  const calc = calculation(skillKey, name);
  assert(calc.mMultiplier && typeof calc.mMultiplier.mNumber === "number" && close(calc.mMultiplier.mNumber, expected), "计算树乘数不符", {
    skillKey, name, actual: calc.mMultiplier, expected,
  });
  return clean(expected);
}

const sourceFiles = Object.fromEntries(Object.entries(inputIntegrity));
const sourceVersion = {
  clientVersion: inputVersion.clientVersion,
  officialVersion: inputVersion.officialVersion,
  build: "16.17.8104348+branch.releases-16-17.content.release",
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
const fixed = (key, name, type, value, description, sortOrder) => parameter(key, name, type, "FIXED", clean(value), null, description, sortOrder);
const levels = (key, name, type, values, description, sortOrder) => parameter(key, name, type, "SKILL_LEVEL", null, values.map(clean), description, sortOrder);
const runtime = (key, name, type, description, sortOrder) => parameter(key, name, type, "RUNTIME_INPUT", null, null, description, sortOrder);
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const add = (left, right) => O("ADD", left, right);
const sub = (left, right) => O("SUBTRACT", left, right);
const mul = (left, right) => O("MULTIPLY", left, right);
const div = (left, right) => O("DIVIDE", left, right);
const min = (left, right) => O("MIN", left, right);
const max = (left, right) => O("MAX", left, right);
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const attrSourceAP = A("SOURCE", "ability_power", "TOTAL");
const attrSourceMoveSpeedBonus = A("SOURCE", "move_speed_percent", "BONUS");

const valueRule = (kind, key) => ({
  value: kind === "PARAMETER" ? { kind, parameterKey: key } : { kind, formulaKey: key },
  fixedMultiplier: 1,
  fixedMinValue: 0,
  fixedMaxValue: null,
});
const persistentLifecycle = (instanceScope = "SOURCE") => ({
  durationValue: null,
  maxStacksValue: { kind: "FIXED", value: 1 },
  applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope,
  reapplicationStackMode: "KEEP",
  reapplicationDurationMode: null,
  expiryMode: "EXPLICIT_ONLY",
  periodicIntervalValue: null,
  firstPeriodicExecution: null,
});
const timedLifecycle = (durationParameterKey, instanceScope = "SOURCE") => ({
  durationValue: { kind: "PARAMETER", parameterKey: durationParameterKey },
  maxStacksValue: { kind: "FIXED", value: 1 },
  applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope,
  reapplicationStackMode: "KEEP",
  reapplicationDurationMode: "REFRESH_ALL",
  expiryMode: "ALL_AT_ONCE",
  periodicIntervalValue: null,
  firstPeriodicExecution: null,
});
const persistentBehavior = (reapplicationValueMode = "REPLACE") => ({
  moment: "PERSISTENT",
  valueReadMode: "APPLICATION_SNAPSHOT",
  stackValueMode: "SHARED",
  reapplicationValueMode,
  periodicExecutionMode: null,
});
const resourceEffect = (effectKey, name, parameterKey, attributeKey, operation, description, sortOrder = 10) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: null,
  results: [{
    resultKey: "resource",
    name,
    resultType: "RESOURCE_CHANGE",
    target: "SOURCE",
    description: null,
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: valueRule("PARAMETER", parameterKey),
    detail: { attributeKey, operation },
  }],
});
const manaEffect = skillKey => resourceEffect(
  "mana_cost",
  "施放法力消耗",
  "mana_cost",
  "mana",
  "CONSUME",
  `仅记录${skillKey}的官方基础法力消耗；公共参数已在当前快照中存在，实际扣除时点与施放资格尚未接线。`,
);
const normalShieldEffect = (effectKey, name, formulaKey, durationKey, absorbedDamageTypeKey, description, sortOrder = 20) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: timedLifecycle(durationKey, "SOURCE"),
  results: [{
    resultKey: "shield",
    name,
    resultType: "NORMAL_SHIELD",
    target: "SOURCE",
    description: null,
    sortOrder: 10,
    lifecycleBehavior: persistentBehavior(),
    spellShieldBlockScope: null,
    valueRule: valueRule("FORMULA", formulaKey),
    detail: { absorbedDamageTypeKey, decayMode: "NONE" },
  }],
});
const attributeEffect = (effectKey, name, formulaKey, attributeKey, durationKey, description, sortOrder = 20, permanent = false) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: permanent ? persistentLifecycle("SOURCE") : timedLifecycle(durationKey, "SOURCE"),
  results: [{
    resultKey: "attribute",
    name,
    resultType: "ATTRIBUTE_CHANGE",
    target: "SOURCE",
    description: null,
    sortOrder: 10,
    lifecycleBehavior: persistentBehavior(),
    spellShieldBlockScope: null,
    valueRule: valueRule("FORMULA", formulaKey),
    detail: { attributeKey, operation: "INCREASE", modifierZoneKey: "attribute_flat_add" },
  }],
});

const writes = {};
const pending = {};
const excluded = {};
const sourceProof = {};
function put(skillKey, parameters, formulas, effects, pendingItems, excludedItems, proofNote) {
  writes[skillKey] = {
    parameters,
    formulas,
    effects,
    processes: [],
    internalStates: [],
    triggerRules: [],
  };
  pending[skillKey] = pendingItems;
  excluded[skillKey] = excludedItems;
  sourceProof[skillKey] = proofNote;
}
function msFromSeconds(value) {
  assert(close(value * 1000, Math.round(value * 1000)), "毫秒换算不是整数", value);
  return Math.round(value * 1000);
}
function dataLevelsParam(skillKey, dataName, sourceIndexStart, expected, key, name, type, description, sortOrder) {
  return levels(key, name, type, selected(skillKey, dataName, sourceIndexStart, expected), description, sortOrder);
}
function dataFixedParam(skillKey, dataName, sourceIndex, expected, key, name, type, description, sortOrder) {
  return fixed(key, name, type, dataScalar(skillKey, dataName, sourceIndex, expected), description, sortOrder);
}
function calcFixedParam(skillKey, calcName, expected, key, name, type, description, sortOrder) {
  return fixed(key, name, type, calculationCoefficient(skillKey, calcName, expected), description, sortOrder);
}

// 迦娜：P
{
  const ratio = dataFixedParam("janna_p", "MSBonusMagicDamage", 0, 0.3, "bonus_move_speed_damage_ratio", "额外移动速度转额外魔法伤害比例", "DECIMAL", "当前根DataValues.MSBonusMagicDamage为0.3；BonusDamage树使用mStat=7、mStatFormula=2，按当前属性目录的额外移动速度比例读取。", 10);
  calculation("janna_p", "MSToOnHitConversionRate");
  calculation("janna_p", "BonusDamage");
  put("janna_p", [ratio], [
    formula("bonus_magic_damage", "顺风而行自身额外魔法伤害", mul(P("bonus_move_speed_damage_ratio"), attrSourceMoveSpeedBonus), "BonusDamage = MSBonusMagicDamage × 来源额外移动速度比例；保留普攻与和风守护的自身伤害换算，不创建自动攻击事件。", 10),
  ], [], [
    { kind: "输入缺口", item: "MSPercentSelf", reason: "当前DataValues无值，不猜造迦娜自身移速。" },
    { kind: "时序", item: "普攻与和风守护伤害触发", reason: "当前正文已证载体，具体命中时点未接线。" },
  ], [
    { kind: "一对一无关", item: "MSPercentAlly", reason: "纯友军朝迦娜移动收益不属于本轮唯一敌人范围。" },
  ], "当前正文与中英文官方资料均明确普攻和和风守护附带额外魔法伤害；树只消费MSBonusMagicDamage与mStat=7/mStatFormula=2。通用属性映射只取当前额外移动速度比例这一窄口径。" );
}

// 迦娜：Q
{
  const parameters = [
    dataLevelsParam("janna_q", "MinDamage", 0, [20, 55, 90, 125, 160], "base_damage", "最小蓄力基础魔法伤害", "INTEGER", "客户端DataValues.MinDamage取索引0至4；与官方16.17.1等级1至5一致。", 10),
    dataFixedParam("janna_q", "MinimumRatio", 0, 0.5, "minimum_ap_ratio", "最小蓄力法强比例", "DECIMAL", "客户端DataValues.MinimumRatio为0.5；MinimumDamage树消费来源总法强。", 20),
    dataLevelsParam("janna_q", "BonusDamage", 0, [5, 10, 15, 20, 25], "charged_damage_base", "每秒蓄力追加基础魔法伤害", "INTEGER", "客户端DataValues.BonusDamage取索引0至4；与ExtraDamagePerSecondCharged树一致。", 30),
    dataFixedParam("janna_q", "BonusRatio", 0, 0.1, "charged_ap_ratio", "每秒蓄力追加法强比例", "DECIMAL", "客户端DataValues.BonusRatio为0.1；仅作为每秒追加项。", 40),
    dataLevelsParam("janna_q", "MaxDuration", 0, [3, 3, 3, 3, 3], "max_charge_duration_seconds", "最大蓄力时间（秒）", "DECIMAL", "客户端DataValues.MaxDuration为3秒；公式与每秒追加项保持秒单位。", 50),
    dataLevelsParam("janna_q", "BaseKnockup", 0, [0.5, 0.5, 0.5, 0.5, 0.5], "base_knockup_seconds", "基础击飞时间（秒）", "DECIMAL", "客户端DataValues.BaseKnockup为0.5秒；显示精度不改变原值。", 60),
    dataLevelsParam("janna_q", "ChargeKnockup", 0, [0.25, 0.25, 0.25, 0.25, 0.25], "charged_knockup_per_second_seconds", "每秒蓄力追加击飞时间（秒）", "DECIMAL", "客户端DataValues.ChargeKnockup为0.25秒；MaxKnockup树以MaxDuration相乘。", 70),
    dataFixedParam("janna_q", "BaseRange", 0, 1100, "base_range", "基础射程", "INTEGER", "客户端DataValues.BaseRange为1100；只作来源参数。", 80),
    dataFixedParam("janna_q", "ChargeDistancePercent", 0, 20, "charge_distance_percent_points", "蓄力射程增加百分数点", "INTEGER", "客户端DataValues.ChargeDistancePercent为20；仅保留来源说明，不把射程变化展开成几何过程。", 90),
    dataFixedParam("janna_q", "MissileTravelTime", 0, 1.25, "missile_travel_time_ms", "龙卷风飞行时间（毫秒）", "INTEGER", "客户端DataValues.MissileTravelTime为1.25秒，换算为1250毫秒；不表示命中时点已接线。", 100),
  ];
  parameters.find(p => p.parameterKey === "missile_travel_time_ms").fixedValue = msFromSeconds(parameters.find(p => p.parameterKey === "missile_travel_time_ms").fixedValue);
  put("janna_q", parameters, [
    formula("minimum_magic_damage", "飓风呼啸最小蓄力魔法伤害", add(P("base_damage"), mul(P("minimum_ap_ratio"), attrSourceAP)), "MinimumDamage = MinDamage + MinimumRatio×来源总法强。", 10),
    formula("charged_magic_damage_per_second", "飓风呼啸蓄力每秒追加魔法伤害", add(P("charged_damage_base"), mul(P("charged_ap_ratio"), attrSourceAP)), "ExtraDamagePerSecondCharged = BonusDamage + BonusRatio×来源总法强。", 20),
    formula("maximum_magic_damage", "飓风呼啸满蓄力魔法伤害", add(
      add(P("base_damage"), mul(P("minimum_ap_ratio"), attrSourceAP)),
      mul(P("max_charge_duration_seconds"), add(P("charged_damage_base"), mul(P("charged_ap_ratio"), attrSourceAP))),
    ), "MaxDamage = MinimumDamage + MaxDuration×ExtraDamagePerSecondCharged；接口公式只能引用参数，故将两棵来源子树完整内联并保持二元结构。", 30),
    formula("maximum_knockup_seconds", "飓风呼啸满蓄力击飞时间", add(P("base_knockup_seconds"), mul(P("max_charge_duration_seconds"), P("charged_knockup_per_second_seconds"))), "MaxKnockup = BaseKnockup + MaxDuration×ChargeKnockup；当前mPrecision=2只为显示精度。", 40),
  ], [manaEffect("janna_q")], [
    { kind: "时序", item: "蓄力、重施、命中与击飞事件", reason: "树和正文给出数值关系，事件资格及命中时点尚未接线。" },
  ], [
    { kind: "一对一无关", item: "MinionMod", reason: "兵线专用分支不进入唯一敌方英雄候选。" },
  ], "四棵当前计算树完整展开；MaxDamage和MaxKnockup的乘积及加法均保持源树顺序，时间参数只把1.25秒转换成1250毫秒。" );
}

// 迦娜：W
{
  const parameters = [
    dataLevelsParam("janna_w", "MSPercent", 0, [0.05, 0.06, 0.07, 0.08, 0.09], "movement_speed_ratio", "自身移动速度比例", "DECIMAL", "客户端DataValues.MSPercent取索引0至4；TotalMS为tooltipOnly，比例直接保存。", 10),
    dataLevelsParam("janna_w", "BaseDamage", 0, [25, 55, 85, 115, 145], "base_damage", "主动基础魔法伤害", "INTEGER", "客户端DataValues.BaseDamage取索引0至4。", 20),
    dataFixedParam("janna_w", "APRatio", 0, 0.5, "ap_ratio", "主动伤害法强比例", "DECIMAL", "客户端TotalDamage树消费APRatio=0.5×来源总法强。", 30),
    fixed("slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("janna_w", "SlowDuration", 0, 2)), "客户端DataValues.SlowDuration为2秒，转换为2000毫秒。", 40),
    dataLevelsParam("janna_w", "SlowPercent", 0, [16, 20, 24, 28, 32], "slow_percent_points", "减速百分数点", "INTEGER", "客户端DataValues.SlowPercent取索引0至4；TotalSlow树再乘0.01。", 50),
    dataFixedParam("janna_w", "MSAPRatio", 0, 0.0002, "movement_speed_ap_ratio", "移动速度法强比例", "DECIMAL", "客户端TotalMS树消费MSAPRatio；当前mDisplayAsPercent=true只表示显示方式。", 60),
    dataFixedParam("janna_w", "SlowAPRatio", 0, 0.06, "slow_ap_ratio", "减速法强比例", "DECIMAL", "客户端TotalSlow树消费SlowAPRatio。", 70),
    fixed("percent_points_to_ratio", "百分数点转比例", "DECIMAL", calculationMultiplier("janna_w", "TotalSlow", 0.01), "客户端TotalSlow根乘数为0.01，将百分数点换为比例；不改变SlowPercent与SlowAPRatio的原始单位。", 80),
    dataFixedParam("janna_p", "MSBonusMagicDamage", 0, 0.3, "tailwind_bonus_damage_ratio", "顺风而行额外魔法伤害比例", "DECIMAL", "当前W正文明确TotalDamage之外再加TailwindSelf:BonusDamage；此处直接使用P树的0.3×额外移动速度，恰好计一次，不创建跨技能公式引用。", 90),
  ];
  const wBase = add(P("base_damage"), mul(P("ap_ratio"), attrSourceAP));
  put("janna_w", parameters, [
    formula("total_move_speed_ratio", "和风守护自身移动速度比例", add(P("movement_speed_ratio"), mul(P("movement_speed_ap_ratio"), attrSourceAP)), "TotalMS = MSPercent + MSAPRatio×来源总法强；该树是自身持续移动速度来源。", 10),
    formula("total_magic_damage", "和风守护对唯一敌人魔法伤害", add(wBase, mul(P("tailwind_bonus_damage_ratio"), attrSourceMoveSpeedBonus)), "W正文的TotalDamage + TailwindSelf:BonusDamage；P换算在W内直接加入一次，普攻仍独立消费P公式。", 20),
    formula("total_slow_ratio", "和风守护减速比例", mul(P("percent_points_to_ratio"), add(P("slow_percent_points"), mul(P("slow_ap_ratio"), attrSourceAP))), "TotalSlow = 0.01×(SlowPercent + SlowAPRatio×来源总法强)。", 30),
  ], [
    manaEffect("janna_w"),
    attributeEffect("self_move_speed", "和风守护自身移动速度", "total_move_speed_ratio", "move_speed_percent", null, "当前W的TotalMS为自身被动移动速度；持久属性候选只描述数值和来源，实际技能初始化时点待接。", 20, true),
  ], [
    { kind: "时序", item: "W主动命中、减速、移动速度应用", reason: "当前文本与树明确数值，实际目标资格和应用时点未接线。" },
    { kind: "来源", item: "P与W的触发先后", reason: "W正文已证只追加一次P的BonusDamage；实际运行事件仍待接。" },
  ], [
    { kind: "一对一无关", item: "纯友军目标收益", reason: "本轮只保留自身移动速度和唯一敌人主动伤害。" },
  ], "W的TotalDamage不在树内复制P；候选单独保留P公式并在W完整主动式中直接加入0.3×来源额外移动速度一次。" );
}

// 迦娜：E
{
  const parameters = [
    dataFixedParam("janna_e", "ECDRefundforCC", 0, 0.2, "cc_cooldown_refund_ratio", "控制命中时冷却返还比例", "DECIMAL", "客户端DataValues.ECDRefundforCC为0.2；控制命中条件仅作来源参数，未创建无条件冷却效果。", 10),
    fixed("empower_duration_ms", "强化持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("janna_e", "EmpowerDuration", 0, 5)), "客户端EmpowerDuration为5秒，转换为5000毫秒。", 20),
    fixed("decay_grace_period_ms", "衰减宽限时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("janna_e", "DecayGracePeriod", 0, 4)), "客户端DecayGracePeriod为4秒，转换为4000毫秒；衰减过程不在本轮展开。", 30),
    dataLevelsParam("janna_e", "BaseShield", 0, [40, 80, 120, 160, 200], "base_shield", "基础护盾值", "INTEGER", "客户端DataValues.BaseShield取索引0至4。", 40),
    dataFixedParam("janna_e", "ShieldAPRatio", 0, 0.55, "shield_ap_ratio", "护盾法强比例", "DECIMAL", "TotalShield树消费ShieldAPRatio=0.55×来源总法强。", 50),
    dataLevelsParam("janna_e", "BonusAD", 0, [5, 10, 15, 20, 25], "bonus_attack_damage", "强化额外攻击力", "INTEGER", "客户端DataValues.BonusAD取索引0至4；TotalAD树消费该基础值。", 60),
    dataFixedParam("janna_e", "ADAPRatio", 0, 0.1, "attack_damage_ap_ratio", "额外攻击力法强比例", "DECIMAL", "客户端TotalAD树消费ADAPRatio=0.1×来源总法强。", 70),
    fixed("shield_duration_ms", "护盾持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("janna_e", "ShieldDuration", 0, 4)), "客户端ShieldDuration为4秒，转换为4000毫秒。", 80),
  ];
  put("janna_e", parameters, [
    formula("total_shield", "风暴之眼自身护盾值", add(P("base_shield"), mul(P("shield_ap_ratio"), attrSourceAP)), "TotalShield = BaseShield + ShieldAPRatio×来源总法强。目标为自身路径，实际友方目标资格待补。", 10),
    formula("total_attack_damage_bonus", "风暴之眼自身额外攻击力", add(P("bonus_attack_damage"), mul(P("attack_damage_ap_ratio"), attrSourceAP)), "TotalAD = BonusAD + ADAPRatio×来源总法强。", 20),
  ], [
    manaEffect("janna_e"),
    normalShieldEffect("self_shield", "风暴之眼自身护盾", "total_shield", "shield_duration_ms", null, "只表达当前TotalShield数值与护盾生命周期；自施放/友方目标资格、衰减和实际吸收尚未接线。", 20),
    attributeEffect("self_attack_damage", "风暴之眼自身攻击力增益", "total_attack_damage_bonus", "attack_damage", "empower_duration_ms", "只表达当前TotalAD数值和5秒强化生命周期；控制命中返还冷却不无条件挂接。", 30),
  ], [
    { kind: "目标资格", item: "自身施放与护盾目标", reason: "当前正文明确友方目标，但没有独立证明自选路径；效果保留为自身候选并不自动触发。" },
    { kind: "时序", item: "控制命中返还冷却与护盾衰减", reason: "ECDRefundforCC与DecayGracePeriod只保留来源参数，未创建无条件结果或周期过程。" },
  ], [], "E的TotalShield与TotalAD各自按当前计算树展开；EmpowerPercent无值未造默认。" );
}

// 迦娜：R
{
  const parameters = [
    dataLevelsParam("janna_r", "HealBasePerSecond", 0, [50, 100, 150], "heal_base_per_second", "每秒基础治疗", "INTEGER", "客户端HealBasePerSecond取索引0至2；根树没有把它写成最终治疗结果。", 10),
    calcFixedParam("janna_r", "HealPerSecond", 0.5, "heal_ap_ratio", "每秒治疗法强比例", "DECIMAL", "HealPerSecond树的StatByCoefficient系数为0.5×来源总法强。", 20),
    dataLevelsParam("janna_r", "Duration", 1, [3, 3, 3], "heal_duration_seconds", "持续治疗时间（秒）", "DECIMAL", "客户端Duration使用等级索引1至3，得到3/3/3秒；不能误用索引0的占位0。", 30),
    dataFixedParam("janna_r", "Range", 0, 700, "heal_range", "复苏季风治疗范围", "INTEGER", "客户端Range为700；只作来源参数。", 40),
    dataFixedParam("janna_r", "MaxKnockback", 0, 875, "max_knockback_distance", "最大击退距离", "INTEGER", "客户端MaxKnockback为875；不把轨迹展开成过程。", 50),
    dataFixedParam("janna_r", "KnockbackBaseRange", 0, 875, "knockback_base_range", "击退基础距离", "INTEGER", "客户端KnockbackBaseRange为875。", 60),
    dataFixedParam("janna_r", "KnockbackSpeed", 0, 1200, "knockback_speed", "击退速度", "INTEGER", "客户端KnockbackSpeed为1200；只作来源参数。", 70),
    dataFixedParam("janna_r", "KnockbackGravity", 0, 10, "knockback_gravity", "击退重力参数", "INTEGER", "客户端KnockbackGravity为10；只作来源参数。", 80),
    fixed("knockback_duration_ms", "击退持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("janna_r", "KnockbackDuration", 0, 0.5)), "客户端KnockbackDuration为0.5秒，转换为500毫秒。", 90),
  ];
  put("janna_r", parameters, [
    formula("heal_per_second", "复苏季风每秒治疗量", add(P("heal_base_per_second"), mul(P("heal_ap_ratio"), attrSourceAP)), "HealPerSecond = HealBasePerSecond + 0.5×来源总法强。", 10),
    formula("total_heal", "复苏季风持续治疗总量", mul(P("heal_duration_seconds"), add(P("heal_base_per_second"), mul(P("heal_ap_ratio"), attrSourceAP))), "TotalHeal = Duration×HealPerSecond；接口公式只能引用参数，故内联每秒治疗式；该量是tooltipOnly数值，不创建直接治疗结果。", 20),
  ], [manaEffect("janna_r")], [
    { kind: "时序", item: "持续治疗周期、移动提前结束和击退轨迹", reason: "当前树只给总持续时间乘法，实际周期与结束时点未证。" },
    { kind: "目标资格", item: "自身是否在附近友军范围内", reason: "保留自身治疗数值，实际目标判定待补。" },
  ], [
    { kind: "一对一无关", item: "纯友军额外治疗分配", reason: "本轮只保留自身可得治疗数值，不生成队友结果。" },
  ], "R严格使用Duration索引1至3的3秒值，避免把3级误取成源数组索引3的0；HealPerSecond和TotalHeal按当前两棵树展开。" );
}

// 璐璐：P
{
  const parameters = [
    dataFixedParam("lulu_p", "NumberOfBolts", 0, 3, "bolts_per_attack", "皮克斯飞弹数量", "INTEGER", "客户端DataValues.NumberOfBolts为3；当前正文明确同一普攻目标发射3颗。", 10),
    dataFixedParam("lulu_p", "APRatioPerHit", 0, 0.05, "ap_ratio_per_bolt", "每颗飞弹法强比例", "DECIMAL", "客户端DataValues.APRatioPerHit为0.05。", 20),
    runtime("actual_character_level_base_damage", "当前角色等级下每颗飞弹基础伤害", "DECIMAL", "TotalDamage树只有角色等级5至39的插值端点；这里的5至39是基础伤害端点，不是英雄等级范围。完整等级曲线未冻结，实际输入无默认。", 30),
  ];
  calculation("lulu_p", "TotalDamage");
  calculation("lulu_p", "CombinedDamage");
  put("lulu_p", parameters, [
    formula("single_bolt_magic_damage", "皮克斯单颗飞弹魔法伤害", add(P("actual_character_level_base_damage"), mul(P("ap_ratio_per_bolt"), attrSourceAP)), "TotalDamage = 当前角色等级基础伤害输入 + APRatioPerHit×来源总法强；不把5至39误作角色等级。", 10),
    formula("combined_magic_damage", "皮克斯同一普攻合计魔法伤害", mul(P("bolts_per_attack"), add(P("actual_character_level_base_damage"), mul(P("ap_ratio_per_bolt"), attrSourceAP))), "CombinedDamage = NumberOfBolts×TotalDamage；接口公式只能引用参数，故内联单颗飞弹公式；同一普攻、同一目标的三颗飞弹合计。", 20),
  ], [], [
    { kind: "触发", item: "跟随英雄普攻后发射", reason: "当前正文明确依附普攻，树没有皮克斯独立施法/攻击事件。" },
    { kind: "输入", item: "角色等级插值曲线", reason: "只保留无默认运行输入，不从两个端点猜中间等级。" },
  ], [], "皮克斯作为依附璐璐普攻的技能载体保留；没有独立自主攻击证据，不创建召唤物事件。" );
}

// 璐璐：Q
{
  const parameters = [
    dataLevelsParam("lulu_q", "BaseDamage", 1, [60, 95, 130, 165, 200], "base_damage", "基础魔法伤害", "INTEGER", "客户端DataValues.BaseDamage取索引1至5；索引0为旧占位25。", 10),
    dataFixedParam("lulu_q", "APRatio", 0, 0.5, "ap_ratio", "法强比例", "DECIMAL", "客户端TotalDamage树消费APRatio=0.5×来源总法强。", 20),
    dataFixedParam("lulu_q", "DoubleHitBonus", 0, 0.5, "second_bolt_bonus_ratio", "同一目标第二束追加比例", "DECIMAL", "客户端BonusMissileDamage的mMultiplier为DoubleHitBonus=0.5；只作用同一目标第二次命中。", 30),
    dataFixedParam("lulu_q", "SlowAmount", 0, -0.8, "slow_ratio", "减速比例", "DECIMAL", "客户端SlowAmount为-0.8，保留原负移动修正比例；不把字段名当作伤害。", 40),
    fixed("slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("lulu_q", "SlowDuration", 0, 2)), "客户端SlowDuration为2秒，转换为2000毫秒。", 50),
    dataFixedParam("lulu_q", "SlowDecayTicks", 0, 8, "slow_decay_ticks", "减速衰减次数", "INTEGER", "客户端SlowDecayTicks为8；衰减时序未接线。", 60),
  ];
  put("lulu_q", parameters, [
    formula("magic_damage", "闪耀长枪首束魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), attrSourceAP)), "TotalDamage = BaseDamage + APRatio×来源总法强。", 10),
    formula("second_bolt_bonus_magic_damage", "闪耀长枪同一目标第二束追加魔法伤害", mul(P("second_bolt_bonus_ratio"), add(P("base_damage"), mul(P("ap_ratio"), attrSourceAP))), "BonusMissileDamage = DoubleHitBonus×同一套TotalDamage；接口公式只能引用参数，故内联首束公式；不扩成第二名敌人。", 20),
  ], [manaEffect("lulu_q")], [
    { kind: "时序", item: "两束命中先后与减速衰减", reason: "保留同一目标第二束关系和8次衰减参数，事件未接线。" },
  ], [
    { kind: "一对一无关", item: "MinionMod", reason: "小兵专用分支不进入唯一敌方英雄候选。" },
  ], "Q的BonusMissileDamage使用同一目标的TotalDamage整体乘0.5，避免误当成额外敌人或完整第二发。" );
}

// 璐璐：W
{
  const parameters = [
    dataFixedParam("lulu_w", "BaseMS", 0, 0.25, "base_move_speed_ratio", "基础移动速度比例", "DECIMAL", "客户端DataValues.BaseMS为0.25。", 10),
    dataLevelsParam("lulu_w", "CCDuration", 1, [1.2, 1.4, 1.6, 1.8, 2], "polymorph_duration_ms", "敌方变形持续时间（毫秒）", "INTEGER", "客户端CCDuration取索引1至5，单位秒转换为1200/1400/1600/1800/2000毫秒。", 20),
    dataFixedParam("lulu_w", "SlowAmount", 0, -60, "slow_percent_points", "变形附带减速百分数点", "INTEGER", "客户端SlowAmount为-60；按当前正文的负值修正取正的60百分数点，仅保留数值不创建控制结果。", 30),
    dataLevelsParam("lulu_w", "MSDuration", 1, [3, 3.25, 3.5, 3.75, 4], "ally_buff_duration_ms", "友方增益持续时间（毫秒）", "INTEGER", "客户端MSDuration取索引1至5，单位秒转换为3000/3250/3500/3750/4000毫秒。", 40),
    dataLevelsParam("lulu_w", "ASBonus", 1, [0.2, 0.225, 0.25, 0.275, 0.3], "attack_speed_bonus_ratio", "攻击速度增益比例", "DECIMAL", "客户端ASBonus取索引1至5；按0.2代表20%保存。", 50),
    fixed("move_speed_ap_ratio", "移动速度法强比例", "DECIMAL", 0.0005, "客户端TotalMS的StatByCoefficient系数为0.0005；同版属性构造窄口径按来源总法强读取。", 60),
  ];
  for (const key of ["polymorph_duration_ms", "ally_buff_duration_ms"]) {
    const p = parameters.find(item => item.parameterKey === key);
    p.levelValues = Object.fromEntries(Object.entries(p.levelValues).map(([level, value]) => [level, msFromSeconds(value)]));
  }
  calculation("lulu_w", "TotalMS");
  put("lulu_w", parameters, [
    formula("ally_move_speed_ratio", "奇思妙想友方移动速度比例", add(P("base_move_speed_ratio"), mul(P("move_speed_ap_ratio"), attrSourceAP)), "TotalMS = BaseMS + 0.0005×来源总法强；只表达友方增益数值，未把变形当作技能替换。", 10),
  ], [
    manaEffect("lulu_w"),
    attributeEffect("self_move_speed", "奇思妙想自身移动速度增益", "ally_move_speed_ratio", "move_speed_percent", "ally_buff_duration_ms", "保留自身作为合法友方目标时的移动速度路径；实际分支选择与应用时点待补。", 20),
    attributeEffect("self_attack_speed", "奇思妙想自身攻击速度增益", "attack_speed_bonus_ratio", "bonus_attack_speed_percent", "ally_buff_duration_ms", "保留自身作为合法友方目标时的攻击速度路径；不把对敌变形分支混入。", 30),
  ], [
    { kind: "目标资格", item: "友方/敌方分支与自身施放", reason: "当前正文明确两分支；自身是否可选及事件时序未单独接线。" },
    { kind: "控制", item: "敌方变形、沉默、缴械、减速", reason: "这些是控制载体，参数保留但本轮不凭自由状态键创建控制结果。" },
  ], [], "W的敌方变形是控制，不能当成完整技能替换；友方移速与攻速数值也保留，自身效果不自动触发。" );
}

// 璐璐：E
{
  const parameters = [
    dataLevelsParam("lulu_e", "BaseDamage", 0, [30, 70, 110, 150, 190], "base_damage", "对敌基础魔法伤害", "INTEGER", "客户端DataValues.BaseDamage取索引0至4。", 10),
    dataFixedParam("lulu_e", "DamageAPRatio", 0, 0.5, "damage_ap_ratio", "伤害法强比例", "DECIMAL", "客户端TotalDamage树消费DamageAPRatio=0.5。", 20),
    dataLevelsParam("lulu_e", "BaseShield", 0, [30, 70, 110, 150, 190], "base_shield", "基础护盾值", "INTEGER", "客户端DataValues.BaseShield取索引0至4；与TotalShield树一致。", 30),
    dataFixedParam("lulu_e", "ShieldAPRatio", 0, 0.5, "shield_ap_ratio", "护盾法强比例", "DECIMAL", "客户端TotalShield树消费ShieldAPRatio=0.5。", 40),
    fixed("shield_duration_ms", "护盾持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("lulu_e", "ShieldDuration", 0, 2.5)), "客户端ShieldDuration为2.5秒，转换为2500毫秒。", 50),
    fixed("pix_ally_duration_ms", "皮克斯友方附着持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("lulu_e", "PixOnAllyDuration", 0, 6)), "客户端PixOnAllyDuration为6秒，转换为6000毫秒；附着时序待补。", 60),
    fixed("pix_enemy_duration_ms", "皮克斯敌方附着持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("lulu_e", "PixOnEnemyDuration", 0, 4)), "客户端PixOnEnemyDuration为4秒，转换为4000毫秒；只作来源参数。", 70),
  ];
  put("lulu_e", parameters, [
    formula("magic_damage", "帮忙皮克斯对唯一敌人魔法伤害", add(P("base_damage"), mul(P("damage_ap_ratio"), attrSourceAP)), "TotalDamage = BaseDamage + DamageAPRatio×来源总法强。", 10),
    formula("shield_value", "帮忙皮克斯自身护盾值", add(P("base_shield"), mul(P("shield_ap_ratio"), attrSourceAP)), "TotalShield = BaseShield + ShieldAPRatio×来源总法强；只保留自身可得路径。", 20),
  ], [
    manaEffect("lulu_e"),
    normalShieldEffect("self_shield", "帮忙皮克斯自身护盾", "shield_value", "shield_duration_ms", null, "保留当前TotalShield和2.5秒生命周期；友方/敌方目标分支及皮克斯附着时序待补。", 20),
  ], [
    { kind: "目标资格", item: "自身护盾路径", reason: "当前正文给出友方护盾与敌方伤害分支，但未单独证明自选资格；不自动触发。" },
    { kind: "时序", item: "皮克斯附着和伤害/护盾应用", reason: "持续时间参数保留，事件和实际应用时点未接线。" },
  ], [], "E的伤害和护盾树分开保存；对唯一敌人的伤害只作为公式，不创建直接伤害结果。" );
}

// 璐璐：R
{
  const parameters = [
    dataLevelsParam("lulu_r", "BonusHealth", 0, [125, 275, 425], "bonus_health", "额外生命值", "INTEGER", "客户端DataValues.BonusHealth取索引0至2。", 10),
    dataLevelsParam("lulu_r", "SlowPercent", 0, [15, 30, 45], "slow_percent_points", "范围减速百分数点", "INTEGER", "客户端DataValues.SlowPercent取索引0至2；只作唯一敌人控制参数。", 20),
    fixed("buff_duration_ms", "生命增益持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("lulu_r", "BuffDuration", 0, 7)), "客户端BuffDuration为7秒，转换为7000毫秒。", 30),
    dataFixedParam("lulu_r", "AoERadius", 0, 400, "aoe_radius", "范围半径", "INTEGER", "客户端AoERadius为400；额外目标分配不展开。", 40),
    fixed("knockup_duration_ms", "击飞持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("lulu_r", "KnockbackDuration", 0, 1)), "客户端KnockbackDuration为1秒，转换为1000毫秒。", 50),
    dataFixedParam("lulu_r", "KnockbackDistance", 0, 275, "knockback_distance", "击退距离", "INTEGER", "客户端KnockbackDistance为275；不展开位移过程。", 60),
    fixed("bonus_health_ap_ratio", "额外生命值法强比例", "DECIMAL", 0.55, "TotalBonusHealth树的StatByCoefficient系数为0.55×来源总法强。", 70),
  ];
  calculation("lulu_r", "TotalBonusHealth");
  put("lulu_r", parameters, [
    formula("bonus_health_value", "狂野生长自身额外生命值", add(P("bonus_health"), mul(P("bonus_health_ap_ratio"), attrSourceAP)), "TotalBonusHealth = BonusHealth + 0.55×来源总法强；只表达自身作为友方目标的数值路径。", 10),
  ], [
    manaEffect("lulu_r"),
    attributeEffect("self_max_health", "狂野生长自身额外生命值", "bonus_health_value", "hp", "buff_duration_ms", "保留自身作为合法友方目标时的最大生命值增益；额外敌人击飞和减速仅作参数，未创建控制结果。", 20),
  ], [
    { kind: "目标资格", item: "自身施放与友方生命增益", reason: "当前正文说明友方目标，实际自选资格待补；候选不自动施加。" },
    { kind: "时序", item: "范围击飞、减速与目标分配", reason: "保留持续和几何参数，未创建多目标控制或位移过程。" },
  ], [], "R的生命增益树完整展开；自身增益保留，唯一敌人控制仅保留有来源的时长/范围参数。" );
}

// 娜美：P
{
  const parameters = [
    dataFixedParam("nami_p", "FlatMS", 0, 100, "flat_move_speed", "踏浪之行固定移动速度", "INTEGER", "客户端DataValues.FlatMS为100；当前正文只直接证明友方英雄命中后的收益。", 10),
    fixed("buff_duration_ms", "踏浪之行持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("nami_p", "BuffDuration", 0, 1.5)), "客户端BuffDuration为1.5秒，转换为1500毫秒。", 20),
    dataFixedParam("nami_p", "UltMult", 0, 2, "ultimate_multiplier", "大招命中移动速度倍数", "DECIMAL", "客户端DataValues.UltMult为2；大招触发条件保留为待核。", 30),
    fixed("ability_power_ratio", "移动速度法强比例", "DECIMAL", 0.25, "TotalMSBonus树的StatByCoefficient系数为0.25×来源总法强；属性选择器为同版窄口径。", 40),
  ];
  calculation("nami_p", "TotalMSBonus");
  put("nami_p", parameters, [
    formula("movement_speed_bonus", "踏浪之行移动速度加成", add(P("flat_move_speed"), mul(P("ability_power_ratio"), attrSourceAP)), "TotalMSBonus = FlatMS + 0.25×来源总法强；触发对象仍按友方命中正文判断。", 10),
  ], [], [
    { kind: "目标资格", item: "娜美自身是否计入友方英雄", reason: "当前正文只写命中友方英雄，未单独证明自触发；不创建无条件自身效果。" },
    { kind: "时序", item: "技能命中与大招倍增", reason: "保留UltMult及持续时间，触发事件未接线。" },
  ], [
    { kind: "一对一无关", item: "纯友方移动速度收益", reason: "本轮不生成队友效果，仅保存可审数学量。" },
  ], "P只保存当前树可求值的移动速度加成，不把友方命中事件误写成娜美自身无条件触发。" );
}

// 娜美：Q
{
  const parameters = [
    dataLevelsParam("nami_q", "BaseDamage", 1, [90, 145, 200, 255, 310], "base_damage", "基础魔法伤害", "INTEGER", "客户端DataValues.BaseDamage取索引1至5；索引0为旧占位35。", 10),
    dataFixedParam("nami_q", "APRatio", 0, 0.5, "ap_ratio", "法强比例", "DECIMAL", "客户端TotalDamageTT树消费APRatio=0.5×来源总法强。", 20),
    fixed("stun_duration_ms", "击飞控制持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("nami_q", "StunDuration", 0, 1.5)), "客户端StunDuration为1.5秒，转换为1500毫秒；控制结果待事件接线。", 30),
  ];
  put("nami_q", parameters, [
    formula("magic_damage", "碧波之牢唯一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), attrSourceAP)), "TotalDamageTT = BaseDamage + APRatio×来源总法强。", 10),
  ], [manaEffect("nami_q")], [
    { kind: "时序", item: "命中、击飞和目标资格", reason: "保留StunDuration参数，未创建控制结果。" },
  ], [], "Q只保存唯一敌人伤害公式和来源击飞时长，不把控制字段伪装成伤害结果。" );
}

// 娜美：W
{
  const parameters = [
    dataLevelsParam("nami_w", "BaseDamage", 1, [60, 95, 130, 165, 200], "base_damage", "基础魔法伤害", "INTEGER", "客户端DataValues.BaseDamage取索引1至5；索引0为旧占位25。", 10),
    dataLevelsParam("nami_w", "BaseHeal", 1, [55, 80, 105, 130, 155], "base_heal", "基础治疗量", "INTEGER", "客户端DataValues.BaseHeal取索引1至5；索引0为旧占位30。", 20),
    dataFixedParam("nami_w", "DamageAPRatio", 0, 0.5, "damage_ap_ratio", "伤害法强比例", "DECIMAL", "客户端TotalDamage树消费DamageAPRatio=0.5。", 30),
    dataFixedParam("nami_w", "HealAPRatio", 0, 0.4, "heal_ap_ratio", "治疗法强比例", "DECIMAL", "客户端TotalHeal树消费HealAPRatio=0.4。", 40),
    dataFixedParam("nami_w", "BounceRatio", 0, -20, "bounce_base_percent_points", "弹跳基础百分数点", "INTEGER", "客户端BounceRatio为-20；BounceScaling根树再乘0.01。", 50),
    dataFixedParam("nami_w", "BounceRatioScaling", 0, 0.15, "bounce_ap_ratio", "弹跳法强百分比点系数", "DECIMAL", "客户端BounceRatioScaling为0.15；只作用弹跳修正项。", 60),
    dataFixedParam("nami_w", "MaxTargets", 0, 3, "max_targets", "最多不同目标数", "INTEGER", "客户端MaxTargets为3；本轮一对一实际最多自身和唯一敌人两个不同目标，不能把3当必达总跳数。", 70),
    fixed("percent_points_to_ratio", "弹跳百分数点转比例", "DECIMAL", calculationMultiplier("nami_w", "BounceScaling", 0.01), "BounceScaling根乘数为0.01。", 80),
    fixed("one_ratio", "完整倍率基准", "DECIMAL", 1, "为二元树表达1+BounceScaling提供固定基准，不是新的游戏参数。", 90),
  ];
  put("nami_w", parameters, [
    formula("first_damage", "冲击之潮首个敌人魔法伤害", add(P("base_damage"), mul(P("damage_ap_ratio"), attrSourceAP)), "TotalDamage = BaseDamage + DamageAPRatio×来源总法强；起点是敌人时为第一段。", 10),
    formula("first_heal", "冲击之潮首个自身治疗量", add(P("base_heal"), mul(P("heal_ap_ratio"), attrSourceAP)), "TotalHeal = BaseHeal + HealAPRatio×来源总法强；起点是自身时为第一段。", 20),
    formula("bounce_scaling_ratio", "冲击之潮弹跳修正比例", mul(P("percent_points_to_ratio"), add(P("bounce_base_percent_points"), mul(P("bounce_ap_ratio"), attrSourceAP))), "BounceScaling = 0.01×(BounceRatio + BounceRatioScaling×来源总法强)。", 30),
    formula("bounced_damage", "冲击之潮第二目标魔法伤害", mul(
      add(P("base_damage"), mul(P("damage_ap_ratio"), attrSourceAP)),
      add(P("one_ratio"), mul(P("percent_points_to_ratio"), add(P("bounce_base_percent_points"), mul(P("bounce_ap_ratio"), attrSourceAP)))),
    ), "第二目标伤害 = 首个伤害×(1+BounceScaling)；接口公式只能引用参数，故内联首段和弹跳修正；一对一只允许敌人和自身各一次。", 40),
    formula("bounced_heal", "冲击之潮第二目标自身治疗量", mul(
      add(P("base_heal"), mul(P("heal_ap_ratio"), attrSourceAP)),
      add(P("one_ratio"), mul(P("percent_points_to_ratio"), add(P("bounce_base_percent_points"), mul(P("bounce_ap_ratio"), attrSourceAP)))),
    ), "第二目标治疗 = 首个治疗×(1+BounceScaling)；接口公式只能引用参数，故内联首段和弹跳修正；不创建直接治疗结果。", 50),
  ], [manaEffect("nami_w")], [
    { kind: "目标资格", item: "起始目标、自身治疗目标和可见后续目标", reason: "当前正文只保证交替且每个目标一次；实际目标筛选与是否能自选自身待补。" },
    { kind: "时序", item: "两目标先后", reason: "本轮按自身→敌人或敌人→自身分别给出首段/第二段公式，不把3跳当必然。" },
  ], [
    { kind: "一对一边界", item: "第三个目标", reason: "MaxTargets=3是全局上限；本轮唯一敌人边界最多两个不同目标。" },
  ], "W保留伤害、治疗和弹跳根乘数；一对一只建首段及第二不同目标公式，严格不生成三次总量。" );
}

// 娜美：E
{
  const parameters = [
    dataLevelsParam("nami_e", "BaseDamage", 1, [20, 35, 50, 65, 80], "base_damage", "附加基础魔法伤害", "INTEGER", "客户端DataValues.BaseDamage取索引1至5；索引0为旧占位5。", 10),
    dataFixedParam("nami_e", "DamageRatio", 0, 0.2, "damage_ap_ratio", "附加伤害法强比例", "DECIMAL", "客户端TotalDamage树消费DamageRatio=0.2。", 20),
    dataLevelsParam("nami_e", "BaseSlow", 1, [15, 20, 25, 30, 35], "slow_percent_points", "附加减速百分数点", "INTEGER", "客户端DataValues.BaseSlow取索引1至5；TotalSlow根树再乘0.01。", 30),
    dataFixedParam("nami_e", "SlowRatio", 0, 0.05, "slow_ap_ratio", "减速法强比例", "DECIMAL", "客户端TotalSlow树消费SlowRatio=0.05。", 40),
    fixed("slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("nami_e", "SlowDuration", 0, 1)), "客户端SlowDuration为1秒，转换为1000毫秒。", 50),
    dataFixedParam("nami_e", "HitCount", 0, 3, "empowered_hit_count", "可强化攻击或技能次数", "INTEGER", "客户端HitCount为3；实际攻击/技能扣除时点待接线。", 60),
    fixed("buff_duration_ms", "强化持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("nami_e", "BuffDuration", 0, 6)), "客户端BuffDuration为6秒，转换为6000毫秒。", 70),
    fixed("percent_points_to_ratio", "百分数点转比例", "DECIMAL", calculationMultiplier("nami_e", "TotalSlow", 0.01), "客户端TotalSlow根乘数为0.01，将BaseSlow与法强项的百分数点换为比例。", 80),
  ];
  calculation("nami_e", "TotalDamage");
  calculation("nami_e", "TotalSlow");
  put("nami_e", parameters, [
    formula("bonus_magic_damage_per_hit", "唤潮之佑每次附加魔法伤害", add(P("base_damage"), mul(P("damage_ap_ratio"), attrSourceAP)), "TotalDamage = BaseDamage + DamageRatio×来源总法强；每次命中只给出单次量。", 10),
    formula("slow_ratio", "唤潮之佑附加减速比例", mul(P("percent_points_to_ratio"), add(P("slow_percent_points"), mul(P("slow_ap_ratio"), attrSourceAP))), "TotalSlow = 0.01×(BaseSlow + SlowRatio×来源总法强)。", 20),
  ], [manaEffect("nami_e")], [
    { kind: "目标资格", item: "自身施放资格", reason: "当前正文写友方英雄，未直接证明娜美自身必然可选；不自动生成自身效果。" },
    { kind: "时序", item: "三次强化命中与持续时间", reason: "保留HitCount和BuffDuration，事件和间隔未接线。" },
  ], [
    { kind: "一对一无关", item: "AoEMod非英雄分支", reason: "AoeMod是非英雄单位群体伤害修正，本轮唯一敌方英雄不录入。" },
  ], "E保留每次附加伤害、减速与三次命中来源参数；AoEMod按Cursor与根审查结论排除，不猜自施放。" );
}

// 娜美：R
{
  const parameters = [
    dataLevelsParam("nami_r", "BaseDamage", 1, [150, 250, 350], "base_damage", "基础魔法伤害", "INTEGER", "客户端DataValues.BaseDamage取索引1至3；索引0为旧占位50。", 10),
    fixed("ap_ratio", "法强比例", "DECIMAL", 0.6, "TotalDamage树的StatByCoefficient系数为0.6×来源总法强。", 20),
    dataFixedParam("nami_r", "PassiveUpdateAreaLength", 0, 200, "passive_update_area_length", "被动更新范围长度", "INTEGER", "客户端PassiveUpdateAreaLength为200；只作来源参数。", 30),
    fixed("knockup_duration_ms", "击飞持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("nami_r", "KnockupDuration", 0, 0.5)), "客户端KnockupDuration为0.5秒，转换为500毫秒。", 40),
    fixed("min_slow_duration_ms", "最短减速持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("nami_r", "MinSlowDuration", 0, 2)), "客户端MinSlowDuration为2秒，转换为2000毫秒。", 50),
    fixed("max_slow_duration_ms", "最长减速持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("nami_r", "MaxSlowDuration", 0, 4)), "客户端MaxSlowDuration为4秒，转换为4000毫秒。", 60),
    dataFixedParam("nami_r", "DistToSlowRatio", 0, 0.002, "distance_to_slow_ratio", "距离到减速持续时间比例", "DECIMAL", "客户端DistToSlowRatio为0.002；距离单位和实际曲线待接，不能自行取整。", 70),
    dataFixedParam("nami_r", "SlowAmount", 0, 70, "slow_percent_points", "减速百分数点", "INTEGER", "客户端SlowAmount为70；只保留控制参数。", 80),
  ];
  put("nami_r", parameters, [
    formula("magic_damage", "怒涛之啸唯一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), attrSourceAP)), "TotalDamage = BaseDamage + 0.6×来源总法强。", 10),
  ], [manaEffect("nami_r")], [
    { kind: "时序", item: "同一目标命中、距离减速曲线与控制", reason: "保留首段伤害和控制数值，未创建击飞/减速结果。" },
    { kind: "触发", item: "大招对友方的P倍增", reason: "纯友方收益不进入本轮效果，但PassiveUpdateAreaLength保留作来源参数。" },
  ], [], "R只保存唯一敌人伤害和官方/客户端控制端点；距离到减速的实际求值留待运行层。" );
}

// 莫甘娜：P
{
  const parameters = [
    dataFixedParam("morgana_p", "HealPercent", 0, 18, "heal_percent_points", "符合条件伤害治疗百分数点", "INTEGER", "客户端DataValues.HealPercent为18；正文明确对符合目标的技能伤害回复该百分比。没有计算树，不造直接治疗量。", 10),
  ];
  put("morgana_p", parameters, [], [], [
    { kind: "触发", item: "符合目标伤害后的治疗与目标类别", reason: "保留18百分数点，实际伤害事件、目标类别和治疗时点未接线。" },
  ], [], "P没有当前计算树，保留正文直接给出的18百分数点并把治疗消费留为条件关系。" );
}

// 莫甘娜：Q
{
  const parameters = [
    dataLevelsParam("morgana_q", "Damage", 1, [80, 135, 190, 245, 300], "base_damage", "基础魔法伤害", "INTEGER", "客户端DataValues.Damage取索引1至5；索引0为旧占位25。", 10),
    calcFixedParam("morgana_q", "TotalDamage", 0.9, "ap_ratio", "法强比例", "DECIMAL", "TotalDamage树的StatByCoefficient系数为0.9×来源总法强。", 20),
    dataLevelsParam("morgana_q", "RootDuration", 1, [2, 2.25, 2.5, 2.75, 3], "root_duration_ms", "禁锢持续时间（毫秒）", "INTEGER", "客户端RootDuration取索引1至5，单位秒转换为2000/2250/2500/2750/3000毫秒。", 30),
  ];
  const rootParam = parameters.find(item => item.parameterKey === "root_duration_ms");
  rootParam.levelValues = Object.fromEntries(Object.entries(rootParam.levelValues).map(([level, value]) => [level, msFromSeconds(value)]));
  put("morgana_q", parameters, [
    formula("magic_damage", "暗之禁锢唯一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), attrSourceAP)), "TotalDamage = Damage + 0.9×来源总法强。", 10),
  ], [manaEffect("morgana_q")], [
    { kind: "时序", item: "命中与禁锢控制", reason: "保留RootDuration，未创建控制结果。" },
  ], [], "Q按客户端等级索引1至5取得80至300基础值，避免占位25污染等级1。" );
}

// 莫甘娜：W
{
  const parameters = [
    dataLevelsParam("morgana_w", "BaseDamage", 1, [18, 31, 44, 57, 70], "base_damage_per_second", "每秒基础魔法伤害", "INTEGER", "客户端DataValues.BaseDamage取索引1至5；索引0为旧占位5。", 10),
    dataFixedParam("morgana_w", "BaseAPRatio", 0, 0.2, "ap_ratio", "法强比例", "DECIMAL", "客户端TotalMinDamage树消费BaseApRatio=0.2×来源总法强；字段大小写差异不改变绑定关系。", 20),
    fixed("tick_interval_ms", "持续伤害间隔（毫秒）", "INTEGER", msFromSeconds(dataScalar("morgana_w", "TickRate", 0, 0.5)), "客户端TickRate为0.5秒，转换为500毫秒；每秒伤害与每跳结算仍分开。", 30),
    dataFixedParam("morgana_w", "MissingHealthAmpPercent", 0, 1, "maximum_missing_health_amplification_ratio", "最大缺失生命增幅比例", "DECIMAL", "客户端TotalMaxDamage乘数为1+MissingHealthAmpPercent；实际目标缺失生命曲线无默认。", 40),
    fixed("duration_ms", "区域持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("morgana_w", "WDuration", 0, 5)), "客户端WDuration为5秒，转换为5000毫秒。", 50),
    dataFixedParam("morgana_w", "CDRefundPercent", 0, 0.05, "passive_heal_cooldown_refund_ratio", "被动治疗后W冷却返还比例", "DECIMAL", "当前正文明确莫甘娜被P治疗时W冷却减少5%；只保留条件参数，不创建无条件冷却效果。", 60),
    fixed("one_ratio", "完整倍率基准", "DECIMAL", 1, "为1+MissingHealthAmpPercent提供固定二元叶子。", 70),
  ];
  put("morgana_w", parameters, [
    formula("minimum_magic_damage_per_second", "折磨之影最低每秒魔法伤害", add(P("base_damage_per_second"), mul(P("ap_ratio"), attrSourceAP)), "TotalMinDamage = BaseDamage + BaseApRatio×来源总法强。", 10),
    formula("maximum_magic_damage_per_second", "折磨之影最高每秒魔法伤害", mul(
      add(P("base_damage_per_second"), mul(P("ap_ratio"), attrSourceAP)),
      add(P("one_ratio"), P("maximum_missing_health_amplification_ratio")),
    ), "TotalMaxDamage = (1+MissingHealthAmpPercent)×TotalMinDamage；接口公式只能引用参数，故内联最低式；实际缺失生命曲线不当作默认最大值。", 20),
  ], [manaEffect("morgana_w")], [
    { kind: "输入", item: "目标缺失生命到增幅的实际曲线", reason: "当前树只有最大分支，缺失生命过程无完整求值式，不能补默认。" },
    { kind: "条件", item: "P治疗后W冷却返还", reason: "保留5%条件参数，P实际治疗事件和W冷却连接未接线。" },
    { kind: "时序", item: "每跳伤害", reason: "TickRate与每秒树分开保存，不把每秒值直接当单跳值。" },
  ], [
    { kind: "一对一无关", item: "MonsterMod", reason: "野怪专用倍率不进入唯一敌方英雄范围。" },
  ], "W同时保存最低和最高根树；最大式明确是来源树的上限分支，实际目标生命增幅与P返还保持条件缺口。" );
}

// 莫甘娜：E
{
  const parameters = [
    dataLevelsParam("morgana_e", "ShieldStrength", 1, [100, 155, 210, 265, 320], "base_shield", "基础魔法护盾值", "INTEGER", "客户端DataValues.ShieldStrength取索引1至5；索引0为旧占位45。", 10),
    fixed("shield_duration_ms", "护盾持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("morgana_e", "ShieldDuration", 0, 5)), "客户端ShieldDuration为5秒，转换为5000毫秒。", 20),
    calcFixedParam("morgana_e", "TotalShieldStrength", 0.7, "shield_ap_ratio", "护盾法强比例", "DECIMAL", "TotalShieldStrength树的StatByCoefficient系数为0.7×来源总法强。", 30),
  ];
  put("morgana_e", parameters, [
    formula("magic_shield_value", "黑暗之盾自身魔法护盾值", add(P("base_shield"), mul(P("shield_ap_ratio"), attrSourceAP)), "TotalShieldStrength = ShieldStrength + 0.7×来源总法强；只表达普通魔法护盾数值。", 10),
  ], [
    manaEffect("morgana_e"),
    normalShieldEffect("magic_shield", "黑暗之盾自身魔法护盾", "magic_shield_value", "shield_duration_ms", "magic", "当前正文和Trait_Shield明确吸收魔法伤害；Trait_CCImmune代表限制/定身免疫语义，不能把它改写成一次性法术护盾。自身目标资格和控制免疫接线待补。", 20),
  ], [
    { kind: "目标资格", item: "自身施放", reason: "当前正文为友方英雄目标，是否包括自身仍需目标证据。" },
    { kind: "控制", item: "限制/定身免疫", reason: "与魔法伤害护盾分开记录；本轮不凭未知状态键创建伪控制结果。" },
  ], [], "E保留普通魔法护盾及控制免疫的分离语义，绝不使用SPELL_SHIELD表示一次技能抵消。" );
}

// 莫甘娜：R
{
  const parameters = [
    dataLevelsParam("morgana_r", "Damage", 1, [200, 275, 350], "base_damage", "基础魔法伤害", "INTEGER", "客户端DataValues.Damage取索引1至3；索引0为旧占位125。", 10),
    calcFixedParam("morgana_r", "TotalDamage", 0.8, "ap_ratio", "法强比例", "DECIMAL", "TotalDamage树的StatByCoefficient系数为0.8×来源总法强。", 20),
    fixed("chain_duration_ms", "锁链持续时间（毫秒）", "INTEGER", msFromSeconds(dataScalar("morgana_r", "ChainDuration", 0, 3)), "客户端ChainDuration为3秒，转换为3000毫秒。", 30),
    levels("stun_duration_ms", "后续眩晕持续时间（毫秒）", "INTEGER", selected("morgana_r", "StunDuration", 1, [1.5, 1.75, 2]).map(msFromSeconds), "客户端StunDuration取索引1至3，单位秒转换为1500/1750/2000毫秒。", 40),
    dataFixedParam("morgana_r", "SlowPercent", 0, 20, "slow_percent_points", "减速百分数点", "INTEGER", "客户端SlowPercent为20；控制效果仅作来源参数。", 50),
    dataLevelsParam("morgana_r", "HastePercent", 1, [20, 40, 60], "self_haste_percent_points", "自身移速加成百分数点", "INTEGER", "客户端HastePercent取索引1至3，得到20/40/60；索引0为占位0。", 60),
  ];
  put("morgana_r", parameters, [
    formula("magic_damage", "灵魂镣铐单次唯一敌人魔法伤害", add(P("base_damage"), mul(P("ap_ratio"), attrSourceAP)), "TotalDamage = Damage + 0.8×来源总法强；同一锁链的后续命中仍由事件层决定是否再次消费。", 10),
  ], [manaEffect("morgana_r")], [
    { kind: "时序", item: "同一目标第二段伤害、断链与控制", reason: "保留链条/眩晕/减速参数，未创建重复伤害或控制事件。" },
  ], [], "R采用客户端等级索引1至3的200/275/350基础伤害与20/40/60自身移速加成端点，避免索引0占位值。" );
}

function officialEvidence(skillKey) {
  const heroId = heroIdByKey[heroKeyOf(skillKey)];
  const slot = slotOf(skillKey);
  const zh = sourceOfficialOf(heroId, slot);
  const en = sourceOfficialEnOf(heroId, slot);
  const pick = value => value ? {
    id: value.id ?? null,
    name: value.name ?? null,
    description: value.description ?? null,
    tooltip: value.tooltip ?? null,
    maxrank: value.maxrank ?? null,
    cooldown: value.cooldown ?? null,
    cost: value.cost ?? null,
    resource: value.resource ?? null,
  } : null;
  return { zh: pick(zh), en: pick(en) };
}

function sourceRecord(skillKey) {
  const hero = sourceHeroOf(skillKey);
  const bound = sourceSkillOf(skillKey);
  const summary = sourceSummaryOf(skillKey);
  const spell = sourceSpellOf(skillKey);
  const heroId = heroIdByKey[hero.key];
  const clientRel = `参考资料/客户端原文/${heroId}.json.gz`;
  const officialZhRel = `参考资料/官方中文/${heroId}.json`;
  const officialEnRel = `参考资料/官方英文/${heroId}.json`;
  return {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    slot: bound.slot,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath,
    spellPath: bound.binding,
    bindingAvailable: bound.bindingAvailable,
    clientFile: clientRel,
    clientSha256: inputIntegrity[clientRel]?.actual ?? hero.source.client.sha256,
    officialZhFile: officialZhRel,
    officialZhSha256: inputIntegrity[officialZhRel]?.actual ?? null,
    officialEnFile: officialEnRel,
    officialEnSha256: inputIntegrity[officialEnRel]?.actual ?? null,
    clientBuild: hero.source.client.contentVersion,
    currentBoundText: bound.currentTexts,
    raw: {
      dataValues: clone(spell.DataValues ?? []),
      calculations: clone(spell.mSpellCalculations ?? {}),
      fields: {
        spellCastTime: spell.spellCastTime ?? null,
        mCastTime: spell.mCastTime ?? null,
        cooldownTime: clone(spell.cooldownTime ?? null),
        mana: clone(spell.mana ?? null),
        manaValues: clone(spell.manaValues ?? null),
        mSpellTags: clone(spell.mSpellTags ?? null),
        mAffectsTypeFlags: spell.mAffectsTypeFlags ?? null,
        mRequiredUnitTags: clone(spell.mRequiredUnitTags ?? null),
        TargetingForgivenessDefinitions: clone(spell.TargetingForgivenessDefinitions ?? null),
      },
    },
    officialEvidence: officialEvidence(skillKey),
    sourceSummary: {
      officialMaxRank: summary.officialMaxRank,
      clientCooldown: clone(summary.clientCooldown),
      clientMana: clone(summary.clientMana),
      dataValueNames: clone(summary.dataValueNames),
      calculationNames: clone(summary.calculationNames),
      note: summary.note,
    },
    selectedData: clone(selectedTrace[skillKey]),
  };
}

function subjectFor(skillKey) {
  const route = `/skills/${skillKey}`;
  const entry = snapshotByRoute.get(route);
  assert(entry?.status === 200 && entry.data, "技能主体保护缺失", skillKey);
  return clone(entry.data);
}
function componentProtection(skillKey) {
  const kinds = [
    ["parameters", "parameters"],
    ["formulas", "formulas"],
    ["effects", "effects"],
    ["processes", "processes"],
    ["internalStates", "internal-states"],
    ["triggerRules", "trigger-rules"],
  ];
  const result = {};
  for (const [key, endpoint] of kinds) {
    const entry = snapshotByRoute.get(`/skills/${skillKey}/${endpoint}`);
    assert(entry?.status === 200 && Array.isArray(entry.data), "技能组成保护缺失", { skillKey, endpoint });
    result[key] = { status: entry.status, count: entry.data.length, dataSha256: sha256(JSON.stringify(entry.data)) };
  }
  const image = snapshotByRoute.get(`/skills/${skillKey}/representative-image`);
  assert(image?.status === 200, "技能代表图保护缺失", skillKey);
  result.representativeImage = { status: image.status, dataSha256: sha256(JSON.stringify(image.data)) };
  return result;
}

const reusedPublicParameters = publicReuse.map(item => ({
  skillKey: item.skillKey,
  parameterKey: item.parameterKey,
  classification: item.classification,
  source: "输入包/参考资料/公共参数复用清单.json",
  post: false,
}));
const reusedSet = new Set(reusedPublicParameters.map(item => `${item.skillKey}|${item.parameterKey}`));
assert(reusedSet.size === 29, "公共参数存在重复", reusedPublicParameters);

function verifyPublicParameter(item) {
  const detail = snapshotByRoute.get(`/skills/${item.skillKey}/parameters/${item.parameterKey}`);
  assert(detail?.status === 200 && detail.data, "公共参数详情保护缺失", item);
  const body = detail.data;
  const heroId = heroIdByKey[heroKeyOf(item.skillKey)];
  const spell = sourceOfficialOf(heroId, slotOf(item.skillKey));
  const expected = item.parameterKey === "cooldown_ms"
    ? (spell.cooldown ?? []).map(value => value * 1000)
    : (spell.cost ?? []);
  if (body.valueMode === "SKILL_LEVEL") {
    const actual = Object.values(body.levelValues ?? {}).map(Number);
    assert(actual.length === expected.length && actual.every((value, index) => close(value, expected[index])), "公共参数与官方数组不一致", { item, actual, expected });
  } else {
    assert(body.valueMode === "FIXED" && expected.length > 0 && close(Number(body.fixedValue), expected[0]), "公共固定参数与官方首项不一致", { item, fixedValue: body.fixedValue, expected });
  }
  return {
    skillKey: item.skillKey,
    parameterKey: item.parameterKey,
    valueMode: body.valueMode,
    valueType: body.valueType,
    fixedValue: body.fixedValue,
    levelValues: body.levelValues,
    expectedOfficialIndex0: expected,
    detailSha256: sha256(JSON.stringify(body)),
  };
}
const publicVerification = reusedPublicParameters.map(verifyPublicParameter);

const skills = {};
for (const skillKey of order) {
  const subject = subjectFor(skillKey);
  const slot = slotOf(skillKey);
  const desiredCategory = slot === "P" ? "passive" : "common";
  skills[skillKey] = {
    skillKey,
    name: subject.name,
    maxLevel: subject.maxLevel,
    currentSubject: subject,
    subjectWrite: {
      planned: false,
      reason: `主体及现有分类保持保护快照；当前候选不更新主体。现有分类=${JSON.stringify(subject.skillCategoryKeys)}，来源技能槽语义=${desiredCategory}。`,
    },
    source: sourceRecord(skillKey),
    write: writes[skillKey],
    pending: pending[skillKey],
    excluded: excluded[skillKey],
    sourceProof: sourceProof[skillKey],
    currentProtection: componentProtection(skillKey),
  };
}

const counts = {
  skills: order.length,
  parameters: order.reduce((sum, key) => sum + skills[key].write.parameters.length, 0),
  formulas: order.reduce((sum, key) => sum + skills[key].write.formulas.length, 0),
  effects: order.reduce((sum, key) => sum + skills[key].write.effects.length, 0),
  processes: 0,
  internalStates: 0,
  triggerRules: 0,
};
assert(counts.skills === 20, "技能槽数量不符", counts);
assert(counts.parameters > 0 && counts.formulas === 35, "候选公式数量不符", counts);
const requestCount = counts.parameters + counts.formulas + counts.effects;

function walkExpression(node, skillKey, pathText = "expression") {
  assert(node && typeof node === "object", "公式节点不是对象", { skillKey, pathText });
  if (node.nodeType === "PARAMETER") {
    assert(skills[skillKey].write.parameters.some(item => item.parameterKey === node.parameterKey) || reusedSet.has(`${skillKey}|${node.parameterKey}`), "公式引用参数未定义", { skillKey, parameterKey: node.parameterKey });
    return;
  }
  if (node.nodeType === "ATTRIBUTE") {
    assert(["SOURCE", "TARGET"].includes(node.attributeOwner), "公式属性所有者不合法", node);
    assert(["TOTAL", "BASE", "BONUS", "CURRENT", "MISSING", "CURRENT_RATIO", "MISSING_RATIO"].includes(node.attributeValueKind), "公式属性取值种类不合法", node);
    return;
  }
  assert(node.nodeType === "OPERATION", "公式节点类型不合法", node);
  assert(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MIN", "MAX"].includes(node.operation), "公式操作不合法", node.operation);
  assert(Array.isArray(node.operands) && node.operands.length === 2, "公式操作数必须严格为2", { skillKey, pathText, node });
  walkExpression(node.operands[0], skillKey, `${pathText}.operands[0]`);
  walkExpression(node.operands[1], skillKey, `${pathText}.operands[1]`);
}
for (const skillKey of order) {
  for (const item of skills[skillKey].write.parameters) {
    if (item.parameterKey.endsWith("_ms")) {
      const values = item.valueMode === "SKILL_LEVEL" ? Object.values(item.levelValues) : [item.fixedValue];
      assert(values.every(value => Number.isInteger(value)), "毫秒参数不是整数", { skillKey, parameterKey: item.parameterKey, values });
    }
    if (item.valueType === "INTEGER" && item.valueMode === "SKILL_LEVEL") {
      assert(Object.values(item.levelValues).every(value => Number.isInteger(value)), "INTEGER等级参数含小数", { skillKey, parameterKey: item.parameterKey });
    }
  }
  for (const formulaItem of skills[skillKey].write.formulas) walkExpression(formulaItem.expression, skillKey, formulaItem.formulaKey);
}

const protectedSummary = {
  inputGETs: protection.GETs,
  protectedSubjects: order.length,
  protectedCompositionLists: order.length * 6,
  protectedRepresentativeImages: order.length,
  protectedCharacters: ["champion_janna", "champion_lulu", "champion_nami", "champion_morgana"],
  protectedCharacterRelations: ["champion_janna", "champion_lulu", "champion_nami", "champion_morgana"],
  protectedCatalogs: ["/attributes", "/skill-categories", "/modifier-zones", "/damage-types"],
  publicParameterDetails: reusedPublicParameters.length,
  classificationCounts: inputVersion.classificationCounts,
};

const candidate = {
  meta: {
    generatedAt,
    batch,
    revision: "hero31-source-v1-candidate",
    status: "候选已生成，等待主负责人审查；未调用业务接口",
    gameId: "lol",
    apiBase,
    sourceVersion,
    sourcePolicy: "固定客户端16.17、官方16.17.1、当前mLocKeys绑定正文和当前计算树；明确值才进入候选，未知时序/曲线/目标资格不猜、不设默认。",
    scope: "迦娜、璐璐、娜美、莫甘娜20个技能槽；唯一敌方英雄1V1。只新增确定参数、实际二元公式、法力消耗和自身护盾/属性增益候选，不创建伤害、直接治疗、控制结果或瞬时求值。",
    sourceBindingSha256: sha256File(sourceBindingPath),
    sourceRangeSha256: sha256File(sourceRangePath),
    semanticEvidenceSha256: sha256File(semanticEvidencePath),
    semanticNoteSha256: sha256File(semanticNotePath),
    sourceReview,
    inputPackage: ".agents/artifacts/hero31-root-entry-20260909",
    protectionSnapshotSha256: sha256File(protectionPath),
    publicReuseSha256: sha256File(publicReusePath),
    sourceIndexSha256: inputVersion.sourceIndexSha256,
    currentGETs: protection.GETs,
    apiCalls: 0,
    businessWrites: 0,
    tokenStored: false,
    candidateSha256: null,
  },
  order,
  skills,
  reusedPublicParameters,
  publicVerification,
  protectedSummary,
  counts,
  requestCount,
  sourceFiles,
  sourceNotes: {
    janna: "W主动公式直接加入P的0.3×来源额外移动速度一次；R Duration使用客户端索引1至3。",
    lulu: "P皮克斯作为依附普攻载体保留；5至39是角色等级基础伤害端点，不是等级范围；Q第二束只修正同一目标。",
    nami: "W一对一最多自身与唯一敌人两个不同目标；P/E自身触发资格待补；E AoEMod为非英雄分支排除。",
    morgana: "E为魔法伤害普通护盾并单独保留控制免疫语义；W最高伤害是缺失生命分支上限，不代替实际曲线。",
    indices: "本批客户端DataValues按各技能实际绑定逐字段核对；带旧占位的数组使用索引1起，迦娜R Duration使用索引1起；官方冷却索引0和法力消耗索引0只用于公共参数校验。",
    attributes: "公式属性字段使用attributeOwner/attributeKey/attributeValueKind；本候选只用SOURCE、TOTAL或BONUS，mStat选择器映射保留窄口径。",
  },
  apiWrites: 0,
};

const candidateBytes = JSON.stringify(candidate, null, 2) + "\n";
writeText(path.join(artifactDir, "完整候选.json"), candidateBytes);
const candidateSha256 = sha256(candidateBytes);

const requestKinds = [
  ["parameters", "parameterKey"],
  ["formulas", "formulaKey"],
  ["effects", "effectKey"],
  ["processes", "processKey"],
  ["internalStates", "stateKey"],
  ["triggerRules", "ruleKey"],
];
const requests = [];
let sequence = 0;
for (const skillKey of order) {
  for (const [kind, identityKey] of requestKinds) {
    for (const body of skills[skillKey].write[kind]) {
      sequence += 1;
      const stableKey = body[identityKey];
      requests.push({
        sequence,
        method: "POST",
        route: `/skills/${skillKey}/${kind === "internalStates" ? "internal-states" : kind === "triggerRules" ? "trigger-rules" : kind}`,
        detailRoute: `/skills/${skillKey}/${kind === "internalStates" ? "internal-states" : kind === "triggerRules" ? "trigger-rules" : kind}/${stableKey}`,
        skillKey,
        kind,
        stableKey,
        status: "仅意图，未调用",
        body,
      });
    }
  }
}
assert(requests.length === requestCount, "请求计数不符", { requests: requests.length, requestCount, counts });

const protectedRoutes = [
  "/attributes", "/skill-categories", "/modifier-zones", "/damage-types",
  ...["champion_janna", "champion_lulu", "champion_nami", "champion_morgana"].flatMap(characterKey => [
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
  generatedAt,
  status: "仅写入意图，未调用业务接口",
  batch,
  revision: "hero31-source-v1-candidate",
  apiBase,
  sourceVersion,
  candidateSha256,
  sourceBindingSha256: sha256File(sourceBindingPath),
  sourceRangeSha256: sha256File(sourceRangePath),
  protectionSnapshotSha256: sha256File(protectionPath),
  publicReuseSha256: sha256File(publicReusePath),
  requestCount,
  counts,
  reusedPublicParameters,
  publicVerification,
  protectedRoutes,
  protectedSummary,
  requests,
  noApiCalls: true,
  apiWrites: 0,
};
const planBytes = JSON.stringify(plan, null, 2) + "\n";
writeText(path.join(artifactDir, "请求计划.json"), planBytes);
const planSha256 = sha256(planBytes);

const sourceValues = {
  generatedAt,
  batch,
  status: "独立源值摘要，未调用业务接口",
  sourceVersion,
  sourceBindingSha256: sha256File(sourceBindingPath),
  sourceRangeSha256: sha256File(sourceRangePath),
  sourceReview,
  inputIntegrity,
  selectedValues: Object.fromEntries(order.map(skillKey => [skillKey, {
    binding: skills[skillKey].source.spellPath,
    officialMaxRank: skills[skillKey].maxLevel,
    selectedData: skills[skillKey].source.selectedData,
    rawDataValues: skills[skillKey].source.raw.dataValues,
    calculations: skills[skillKey].source.raw.calculations,
    formulas: skills[skillKey].write.formulas.map(item => ({ formulaKey: item.formulaKey, name: item.name, description: item.description })),
    parameterValues: skills[skillKey].write.parameters.map(item => ({
      parameterKey: item.parameterKey,
      valueType: item.valueType,
      valueMode: item.valueMode,
      fixedValue: item.fixedValue,
      levelValues: item.levelValues,
    })),
  }])),
  scope: Object.fromEntries(order.map(skillKey => [
    skillKey,
    { pending: pending[skillKey], excluded: excluded[skillKey] },
  ])),
  noApiCalls: true,
};
const sourceValuesBytes = JSON.stringify(sourceValues, null, 2) + "\n";
writeText(path.join(artifactDir, "来源值摘要.json"), sourceValuesBytes);
const sourceValuesSha256 = sha256(sourceValuesBytes);

const sourceScope = {
  generatedAt,
  batch,
  revision: "hero31-source-v1-candidate",
  status: "候选已生成，严格数学脚本另行核对；未调用业务接口",
  sourceVersions: sourceVersion,
  sourceBindingSha256: sha256File(sourceBindingPath),
  sourceRangeSha256: sha256File(sourceRangePath),
  semanticEvidenceSha256: sha256File(semanticEvidencePath),
  cursorReviewSha256: sourceReview.conclusionSha256,
  categories: sourceRange.categories,
  perSkill: Object.fromEntries(order.map(skillKey => [skillKey, {
    included: sourceRange.skills[skillKey]?.scope?.recordable ?? [],
    oneVsOneIrrelevant: sourceRange.skills[skillKey]?.scope?.oneVsOneIrrelevant ?? [],
    unknownTimingOrCurve: sourceRange.skills[skillKey]?.scope?.unknownTimingOrCurve ?? [],
    candidatePending: pending[skillKey],
    candidateExcluded: excluded[skillKey],
  }])),
  counts,
  requestCount,
  publicReuse: reusedPublicParameters.length,
  protectedSummary,
  hashes: {
    candidateSha256,
    planSha256,
    sourceValuesSha256,
  },
  noApiCalls: true,
};
writeJson(path.join(artifactDir, "来源与范围.json"), sourceScope);

const summary = {
  generatedAt,
  batch,
  revision: "hero31-source-v1-candidate",
  sourceVersion,
  sourceBindingSha256: sha256File(sourceBindingPath),
  sourceRangeSha256: sha256File(sourceRangePath),
  semanticEvidenceSha256: sha256File(semanticEvidencePath),
  cursorReview: sourceReview,
  counts,
  requestCount,
  publicReuse: reusedPublicParameters.length,
  businessWrites: 0,
  apiCalls: 0,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  strictMath: "独立数学核算.json",
  strictMathStatus: "待执行",
  protectedSummary,
  noApiCalls: true,
};
writeJson(path.join(artifactDir, "候选版本.json"), summary);
writeJson(path.join(artifactDir, "来源哈希汇总.json"), {
  generatedAt,
  batch,
  inputPackage: ".agents/artifacts/hero31-root-entry-20260909",
  sourceFiles,
  frozenHashes: {
    inputVersionSha256: sha256File(inputVersionPath),
    sourceBindingSha256: sha256File(sourceBindingPath),
    sourceRangeSha256: sha256File(sourceRangePath),
    protectionSnapshotSha256: sha256File(protectionPath),
    publicReuseSha256: sha256File(publicReusePath),
    semanticEvidenceSha256: sha256File(semanticEvidencePath),
    semanticNoteSha256: sha256File(semanticNotePath),
  },
  cursorReview: sourceReview,
  outputs: { candidateSha256, planSha256, sourceValuesSha256 },
  noApiCalls: true,
});

const readme = `# 第三十一批候选

本目录是迦娜、璐璐、娜美、莫甘娜20个技能槽的候选阶段材料。输入包固定客户端16.17、官方资料16.17.1和当前绑定正文；输入阶段201条GET、业务写入为0，Cursor来源复核为READY。本批生成器没有调用业务接口。

当前保护快照中的20个主体、120个组成列表、20张代表图、4个角色及关系、四类公共字典和29项公共参数均作为保护对象。候选请求只包含新增参数、公式和效果意图；公共参数 cooldown_ms、mana_cost 只复用，不更新或重建。

候选只保存来源树能确定的数值。所有公式节点使用两个操作数；毫秒参数和整数计数保持整数；角色等级插值、目标资格、触发时序和缺失生命曲线没有默认值。没有创建伤害结果、直接治疗、控制结果、瞬时求值或周期过程。

关键边界：迦娜W把P的0.3倍额外移动速度换算加入一次；迦娜R持续时间使用客户端等级索引1至3。璐璐P的5至39是角色等级基础伤害端点；娜美W在唯一敌人一对一范围最多两个不同目标；莫甘娜E把魔法护盾和控制免疫分开表达，莫甘娜W的最高式只表示来源上限分支。

文件入口：完整候选.json、请求计划.json、来源值摘要.json、来源与范围.json、独立数学核算.mjs。候选是静态设计证据，不代表业务入库、页面验收或战斗运行。
`;
writeText(path.join(artifactDir, "README.md"), readme);

// 仅把本批候选材料复制到获准的持久目录；输入包和其它批次不写。
const durableFiles = [
  "完整候选.json", "请求计划.json", "来源值摘要.json", "来源与范围.json", "候选版本.json", "来源哈希汇总.json", "README.md",
];
for (const file of durableFiles) {
  fs.mkdirSync(durableDir, { recursive: true });
  fs.copyFileSync(path.join(artifactDir, file), path.join(durableDir, file));
}

console.log(JSON.stringify({
  batch,
  generatedAt,
  counts,
  requestCount,
  publicReuse: reusedPublicParameters.length,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceReview,
  protectedSummary,
  apiCalls: 0,
  businessWrites: 0,
}, null, 2));
