import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero44-root-entry-20260910");
const DURABLE = path.resolve("C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十四批");
const OUTPUT_ROOT = process.env.HERO44_OUTPUT_DIR ? path.resolve(process.env.HERO44_OUTPUT_DIR) : ROOT;
const OUTPUT_DURABLE = process.env.HERO44_DURABLE_DIR ? path.resolve(process.env.HERO44_DURABLE_DIR) : DURABLE;
const REVIEW = path.resolve(ROOT, "..", "hero44-cursor-review-run-20260910");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "第四十四批俄洛伊孙悟空妮蔻悠米";
const REVISION = process.env.HERO44_REVISION || "hero44-source-v1-luna-candidate";
const SOURCE_VERSION = { clientVersion: "16.17", officialVersion: "16.17.1", build: "16.17.8104348+branch.releases-16-17.content.release" };

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, "utf8"); };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const norm = value => Math.abs(Number(value)) < 1e-7 ? 0 : Number(Number(value).toFixed(10));

const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const versionFile = path.join(INPUT, "输入版本.json");
const rangeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const sourceNoteFile = path.join(INPUT, "主负责人源值核对说明.md");
const supplementFile = path.join(INPUT, "Cursor复核后补充.md");
const snapshotFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
for (const file of [bindingFile, versionFile, rangeFile, sourceNoteFile, snapshotFile, reuseFile, attributeFile, payloadFile]) {
  assert(fs.existsSync(file), "缺少冻结输入或主负责人补充：" + file);
}

const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const snapshot = readJson(snapshotFile);
const reuseList = readJson(reuseFile);
const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => {
  const sourceMeta = Object.fromEntries((hero.source.skills || []).map(skill => [skill.slot, skill]));
  return [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, { ...skill, ...(sourceMeta[skill.slot] || {}) }]))];
}));
const reuseSet = new Set(reuseList.map(item => item.skillKey + "/" + item.parameterKey));
const snapByRoute = new Map((snapshot.requests || []).map(item => [item.route, item]));
const reviewAudit = readJson(path.join(REVIEW, "主负责人执行审计.json"));
const sourceReview = {
  conclusionFile: ".agents/artifacts/hero44-cursor-review-run-20260910/Cursor来源复核结论.md",
  conclusionSha256: shaFile(path.join(REVIEW, "Cursor来源复核结论.md")),
  auditFile: ".agents/artifacts/hero44-cursor-review-run-20260910/主负责人执行审计.json",
  auditSha256: shaFile(path.join(REVIEW, "主负责人执行审计.json")),
  inputManifestFile: ".agents/artifacts/hero44-cursor-review-run-20260910/path-signatures-before.json",
  inputManifestSha256: shaFile(path.join(REVIEW, "path-signatures-before.json")),
  verdict: "READY",
  runId: reviewAudit.runId,
  requestId: reviewAudit.requestId,
  events: reviewAudit.events,
  uniqueTools: reviewAudit.uniqueTools,
  inputsChecked: reviewAudit.inputsChecked,
  apiWrites: reviewAudit.apiWrites,
  gitDelta: reviewAudit.gitDelta,
  reviewedPlanRev: reviewAudit.reviewedPlanRev,
};

const sourceFiles = {};
for (const item of inputVersion.sourceFiles || []) {
  const file = path.join(INPUT, item.path.replaceAll("/", path.sep));
  assert(fs.existsSync(file), "输入源文件不存在：" + item.path);
  assert(shaFile(file) === item.sha256, "输入源文件散列不一致：" + item.path);
  sourceFiles[item.path.replaceAll("\\", "/")] = { sha256: shaFile(file), byteSize: fs.statSync(file).size };
}
for (const pair of [
  ["来源绑定与当前文本.json", bindingFile],
  ["输入版本.json", versionFile],
  ["主负责人范围与核对要求.md", rangeFile],
  ["主负责人源值核对说明.md", sourceNoteFile],
  ["参考资料/当前20槽保护快照.json", snapshotFile],
]) sourceFiles[pair[0]] = { sha256: shaFile(pair[1]), byteSize: fs.statSync(pair[1]).size };
if (fs.existsSync(supplementFile)) sourceFiles["Cursor复核后补充.md"] = { sha256: shaFile(supplementFile), byteSize: fs.statSync(supplementFile).size };

const spell = (heroId, slot) => {
  const skill = sourceSkills[heroId]?.[slot];
  assert(skill, "缺少源技能：" + heroId + "/" + slot);
  return skill.object.mSpell;
};
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot).DataValues || []).find(item => item.name === name);
  assert(row && Array.isArray(row.values), "缺少DataValue：" + heroId + "/" + slot + "/" + name);
  return row.values;
};
const at = (heroId, slot, name, index = 1) => dataRow(heroId, slot, name)[index];
const skillValues = (heroId, slot, name, max, transform = value => value) => {
  const values = dataRow(heroId, slot, name);
  assert(values.length >= max + 1, "等级数组长度不足：" + heroId + "/" + slot + "/" + name);
  return Object.fromEntries(Array.from({ length: max }, (_, i) => [String(i + 1), norm(transform(values[i + 1]))]));
};
const sourceFixed = (heroId, slot, name, index = 1, transform = value => value) => norm(transform(at(heroId, slot, name, index)));
const rawCalc = (heroId, slot, name) => {
  const value = spell(heroId, slot).mSpellCalculations?.[name];
  assert(value, "缺少计算树：" + heroId + "/" + slot + "/" + name);
  return value;
};
const rawPart = (heroId, slot, calcName, index = 0) => {
  const value = rawCalc(heroId, slot, calcName).mFormulaParts?.[index];
  assert(value, "缺少计算树分支：" + heroId + "/" + slot + "/" + calcName + "/" + index);
  return value;
};
const rawCoefficient = (heroId, slot, calcName, index = 1) => {
  const part = rawPart(heroId, slot, calcName, index);
  assert(typeof part.mCoefficient === "number", "缺少计算树系数：" + heroId + "/" + slot + "/" + calcName);
  return norm(part.mCoefficient);
};
const rawNumber = (heroId, slot, calcName, index = 0) => {
  const part = rawPart(heroId, slot, calcName, index);
  assert(typeof part.mNumber === "number", "缺少计算树数字：" + heroId + "/" + slot + "/" + calcName);
  return norm(part.mNumber);
};
const toMs = seconds => {
  const ms = Number(seconds) * 1000;
  const rounded = Math.round(ms);
  assert(Number.isFinite(ms) && Math.abs(ms - rounded) < 0.1 && rounded >= 0, "时间不是非负整数毫秒：" + seconds);
  return rounded;
};
const time = (heroId, slot, field) => {
  const value = spell(heroId, slot)[field];
  assert(typeof value === "number", "缺少时间字段：" + heroId + "/" + slot + "/" + field);
  return toMs(value);
};
const officialFor = (heroId, slot, english) => {
  const file = path.join(INPUT, "参考资料", english ? "官方英文" : "官方中文", heroId + ".json");
  const root = readJson(file).data[heroId];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};
const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const meta = sourceSkills[heroId][slot];
  const sp = spell(heroId, slot);
  const clientFile = path.join(INPUT, "参考资料", "客户端原文", heroId + ".json.gz");
  const zhFile = path.join(INPUT, "参考资料", "官方中文", heroId + ".json");
  const enFile = path.join(INPUT, "参考资料", "官方英文", heroId + ".json");
  return {
    hero: heroId, heroName: hero.name, heroKey: hero.key, slot, resourceType: hero.source.resourceType, rootPath: hero.source.rootPath,
    spellPath: meta.binding, bindingAvailable: meta.bindingAvailable,
    clientFile: "参考资料/客户端原文/" + heroId + ".json.gz", clientSha256: shaFile(clientFile), clientCompressedSha256: hero.source.client.compressedSha256, clientBuild: hero.source.client.contentVersion,
    officialZhFile: "参考资料/官方中文/" + heroId + ".json", officialZhSha256: shaFile(zhFile), officialEnFile: "参考资料/官方英文/" + heroId + ".json", officialEnSha256: shaFile(enFile),
    currentBoundText: clone(meta.currentTexts),
    raw: {
      dataValues: Object.fromEntries((sp.DataValues || []).map(row => [row.name, clone(row.values)])),
      calculations: clone(sp.mSpellCalculations || {}),
      fields: {
        mEffectAmount: sp.mEffectAmount === undefined ? null : clone(sp.mEffectAmount), mCastTime: sp.mCastTime === undefined ? null : sp.mCastTime,
        spellCastTime: sp.spellCastTime === undefined ? null : sp.spellCastTime, spellTotalTime: sp.spellTotalTime === undefined ? null : sp.spellTotalTime,
        cooldownTime: sp.cooldownTime === undefined ? null : clone(sp.cooldownTime), mana: sp.mana === undefined ? null : clone(sp.mana),
        manaValues: sp.manaValues === undefined ? null : clone(sp.manaValues), mMaxAmmo: sp.mMaxAmmo === undefined ? null : clone(sp.mMaxAmmo),
        mAmmoRechargeTime: sp.mAmmoRechargeTime === undefined ? null : clone(sp.mAmmoRechargeTime), mTargetingTypeData: sp.mTargetingTypeData === undefined ? null : clone(sp.mTargetingTypeData),
      },
    },
    officialEvidence: { zh: clone(officialFor(heroId, slot, false)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot + "/currentTexts", officialMaxRank: meta.officialMaxRank,
  };
};

const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (owner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner: owner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const SUB = (left, right) => O("SUBTRACT", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);
const MAX = (left, right) => O("MAX", left, right);
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const AD = () => A("SOURCE", "attack_damage", "TOTAL");
const BAD = () => A("SOURCE", "attack_damage", "BONUS");
const HP = () => A("SOURCE", "hp", "TOTAL");
const THP = () => A("TARGET", "hp", "TOTAL");
const fixed = (key, name, type, value, description, sortOrder) => ({ parameterKey: key, name, valueType: type, valueMode: "FIXED", fixedValue: norm(value), levelValues: null, description, sortOrder });
const level = (key, name, type, values, description, sortOrder) => ({ parameterKey: key, name, valueType: type, valueMode: "SKILL_LEVEL", fixedValue: null, levelValues: values, description, sortOrder });
const character = (key, name, type, values, description, sortOrder) => ({ parameterKey: key, name, valueType: type, valueMode: "CHARACTER_LEVEL", fixedValue: null, levelValues: values, description, sortOrder });
const runtime = (key, name, type, description, sortOrder) => ({ parameterKey: key, name, valueType: type, valueMode: "RUNTIME_INPUT", fixedValue: null, levelValues: null, description, sortOrder });
const formula = (key, name, expression, description, sortOrder) => ({ formulaKey: key, name, expression, description, sortOrder });

const lifecycle = durationKey => ({
  durationValue: durationKey ? { kind: "PARAMETER", parameterKey: durationKey } : null,
  maxStacksValue: { kind: "FIXED", value: 1 }, applicationStacksValue: { kind: "FIXED", value: 1 }, instanceScope: "SOURCE",
  reapplicationStackMode: "KEEP", reapplicationDurationMode: durationKey ? "REFRESH_ALL" : null, expiryMode: durationKey ? "ALL_AT_ONCE" : "EXPLICIT_ONLY",
  periodicIntervalValue: null, firstPeriodicExecution: null,
});
const resourceEffect = (resource, parameterKey, note) => ({
  effectKey: resource + "_cost", name: "施放" + (resource === "mana" ? "法力" : "能量") + "消耗", description: note + "仅记录基础资源消耗，实际扣除时点由事件层接线。", sortOrder: 900, lifecycle: null,
  results: [{ resultKey: "consume_resource", name: "施放资源消耗", resultType: "RESOURCE_CHANGE", target: "SOURCE", description: "不表示战斗事件已经接线。", sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: { value: { kind: "PARAMETER", parameterKey }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { attributeKey: resource, operation: "CONSUME" } }],
});
const attrEffect = (effectKey, name, description, value, attributeKey, zone, durationKey, sortOrder) => ({
  effectKey, name, description, sortOrder, lifecycle: lifecycle(durationKey), results: [{ resultKey: "attribute", name, resultType: "ATTRIBUTE_CHANGE", target: "SOURCE", description: "只定义自身属性变化，触发条件由事件层接线。", sortOrder: 10, lifecycleBehavior: { moment: "PERSISTENT", valueReadMode: "APPLICATION_SNAPSHOT", stackValueMode: "SHARED", reapplicationValueMode: "REPLACE", periodicExecutionMode: null }, spellShieldBlockScope: null, valueRule: { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { attributeKey, operation: "INCREASE", modifierZoneKey: zone } }],
});
const shieldEffect = (effectKey, name, description, formulaKey, durationKey, sortOrder) => ({
  effectKey, name, description, sortOrder, lifecycle: lifecycle(durationKey), results: [{ resultKey: "shield", name, resultType: "NORMAL_SHIELD", target: "SOURCE", description: "普通护盾；触发和移除事件由事件层接线。", sortOrder: 10, lifecycleBehavior: { moment: "PERSISTENT", valueReadMode: "APPLICATION_SNAPSHOT", stackValueMode: "SHARED", reapplicationValueMode: "REPLACE", periodicExecutionMode: null }, spellShieldBlockScope: null, valueRule: { value: { kind: "FORMULA", formulaKey }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { absorbedDamageTypeKey: null, decayMode: "NONE" } }],
});

const rawBreakpoint = (heroId, slot, calcName) => {
  const part = rawPart(heroId, slot, calcName);
  assert(typeof part.mLevel1Value === "number", "断点树缺少起点：" + heroId + "/" + slot + "/" + calcName);
  let value = part.mLevel1Value;
  const points = (part.mBreakpoints || []).slice().sort((a, b) => a.mLevel - b.mLevel);
  const out = {};
  for (let charLevel = 1; charLevel <= 18; charLevel += 1) {
    if (charLevel > 1) {
      const slope = points.slice().reverse().find(point => point.mLevel <= charLevel - 1 && typeof point.mBonusPerLevelAtAndAfter === "number");
      value += slope ? slope.mBonusPerLevelAtAndAfter : (part.mInitialBonusPerLevel || 0);
      for (const point of points.filter(item => item.mLevel === charLevel)) value += point.mAdditionalBonusAtThisLevel || 0;
    }
    out[String(charLevel)] = norm(value);
  }
  return out;
};
const levelResource = (heroId, slot, maxLevel, add) => {
  const key = heroId.toLowerCase() + "_" + slot.toLowerCase();
  const meta = sourceSkills[heroId][slot];
  const result = { cooldownKey: null, manaKey: null };
  const cooldownConflict = heroId === "Yuumi" && slot === "E";
  if (Array.isArray(meta.cooldown) && meta.cooldown.some(value => Number(value) !== 0) && !cooldownConflict && !reuseSet.has(key + "/cooldown_ms")) {
    result.cooldownKey = "cooldown_ms";
    add(level("cooldown_ms", "基础冷却时间（毫秒）", "INTEGER", Object.fromEntries(meta.cooldown.slice(0, maxLevel).map((value, index) => [String(index + 1), toMs(value)])), "当前绑定的官方16.17.1基础冷却，单位转为毫秒；公共参数不在此重复。", 800));
  } else if (Array.isArray(meta.cooldown) && meta.cooldown.some(value => Number(value) !== 0) && !cooldownConflict) result.cooldownKey = "cooldown_ms";
  if (Array.isArray(meta.cost) && meta.cost.some(value => Number(value) !== 0) && !reuseSet.has(key + "/mana_cost")) {
    result.manaKey = "mana_cost";
    add(level("mana_cost", "基础法力消耗", "INTEGER", Object.fromEntries(meta.cost.slice(0, maxLevel).map((value, index) => [String(index + 1), norm(value)])), "当前绑定的官方16.17.1基础法力消耗；公共参数不在此重复。", 810));
  } else if (Array.isArray(meta.cost) && meta.cost.some(value => Number(value) !== 0)) result.manaKey = "mana_cost";
  return result;
};

const defs = {};
const define = (heroId, slot, name, maxLevel, build, excluded, pending, proofNote) => {
  const skillKey = heroId.toLowerCase() + "_" + slot.toLowerCase();
  const writeSet = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  const add = item => {
    if (reuseSet.has(skillKey + "/" + item.parameterKey)) return;
    assert(!writeSet.parameters.some(existing => existing.parameterKey === item.parameterKey), "重复参数：" + skillKey + "/" + item.parameterKey);
    writeSet.parameters.push(item);
  };
  const addF = item => { assert(!writeSet.formulas.some(existing => existing.formulaKey === item.formulaKey), "重复公式：" + skillKey + "/" + item.formulaKey); writeSet.formulas.push(item); };
  const resources = heroId === "Yuumi" && slot === "W" ? { cooldownKey: null, manaKey: null } : levelResource(heroId, slot, maxLevel, add);
  build(add, addF, writeSet, resources);
  if (resources.manaKey) writeSet.effects.push(resourceEffect("mana", resources.manaKey, reuseSet.has(skillKey + "/mana_cost") ? "复用冻结公共法力参数；" : "本技能使用候选新增法力参数；"));
  defs[skillKey] = {
    skillKey, name: heroes[heroId].name + "·" + name, maxLevel, source: sourceFor(heroId, slot), write: writeSet,
    protectedExisting: { subject: Boolean(snapByRoute.get("/skills/" + skillKey)), compositionLists: true, protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json" },
    excluded, pending,
    proofs: [{ type: "root-bound-source", path: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot }, { type: "fixed-source-version", client: SOURCE_VERSION.clientVersion, official: SOURCE_VERSION.officialVersion, build: SOURCE_VERSION.build }, { type: "cursor-source-review", runId: sourceReview.runId, verdict: sourceReview.verdict }, { type: "principal-source-note", path: "输入包/主负责人源值核对说明.md" }],
    proofNote, currentSubject: snapByRoute.get("/skills/" + skillKey)?.data || null,
  };
};
const spLevel = (heroId, slot, dataName, max, parameterKey, name, type, description, sortOrder, transform = value => value) => level(parameterKey, name, type, skillValues(heroId, slot, dataName, max, transform), description, sortOrder);
const spFixed = (heroId, slot, dataName, parameterKey, name, type, description, sortOrder, index = 1, transform = value => value) => fixed(parameterKey, name, type, sourceFixed(heroId, slot, dataName, index, transform), description, sortOrder);

// 俄洛伊
define("Illaoi", "P", "古神先知", 1, (add, addF) => {
  add(spFixed("Illaoi", "P", "MissingHPPercentHeal", "missing_hp_heal_ratio", "已损失生命治疗比例", "DECIMAL", "当前正文消费5%已损失生命；比例本身按1表示100%。", 10));
  add(fixed("slam_min_enemy_champions", "触手治疗所需敌方英雄数", "INTEGER", 1, "当前正文明确至少命中1名敌方英雄。", 50));
  add(runtime("missing_hp_at_slam", "猛击时已损失生命值（实际输入）", "DECIMAL", "治疗公式需要施放时已损失生命实际输入；未知值无默认。", 60));
  addF(formula("self_missing_health_heal", "俄洛伊自身已损失生命治疗量", MUL(P("missing_hp_heal_ratio"), P("missing_hp_at_slam")), "当前本体触手猛击命中至少一名敌方英雄时，5%×施放时已损失生命；触发链待接。", 10));
}, [
  { item: "独立触手生成、单位选取和自主猛击", reason: "按主负责人说明跳过独立召唤单位模型；本体Q/W/R载体另行保留。" },
  { item: "独立触手寿命与多触手伤害衰减", reason: "自主单位的寿命与多触手衰减不属于本体P治疗候选；仅随原始来源留档。" },
], [
], "保留本体触手猛击触发的自身治疗比例；自主触手寿命、生成、衰减和攻击链单列排除。");

define("Illaoi", "Q", "触手猛击", 5, (add, addF) => {
  add(spLevel("Illaoi", "Q", "TentacleDamageAmp", 5, "tentacle_damage_amp", "触手伤害提升比例", "DECIMAL", "当前完整公式使用技能等级1至5的0.10至0.30；比例本身按1表示100%。", 10));
  add(spFixed("Illaoi", "Q", "TotalADRatio", "total_ad_ratio", "总攻击力倍率", "DECIMAL", "当前完整公式第一攻击力项为1.1×来源总攻击力。", 20));
  add(spFixed("Illaoi", "Q", "APRatio", "ap_ratio", "法强倍率", "DECIMAL", "当前完整公式法强项为0.4×来源法强。", 30));
  add(runtime("tentacle_damage_base_at_character_level", "角色等级触手基础伤害（实际输入）", "DECIMAL", "当前完整放大树为角色等级基础9至180，中间曲线未知；不带默认。", 40));
  add(fixed("tentacle_damage_base_start", "完整放大树基础起点", "INTEGER", 9, "TentacleDamageTotal角色等级插值起点。", 60));
  add(fixed("tentacle_damage_base_end", "完整放大树基础终点", "INTEGER", 180, "TentacleDamageTotal角色等级插值终点；中间值由实际输入提供。", 70));
  addF(formula("tentacle_damage", "本体主动触手猛击物理伤害", MUL(ADD(P("tentacle_damage_base_at_character_level"), ADD(MUL(P("total_ad_ratio"), AD()), MUL(P("ap_ratio"), AP()))), ADD(fixedParam("one"), P("tentacle_damage_amp"))), "主动Q是本体施放载体，完整树为(1+技能放大)×(角色等级基础+1.1×总攻击力+0.4×法强)；自主触手结果另列排除。", 10));
}, [
  { item: "独立触手单位的自主猛击结果", reason: "主动Q本体伤害保留；独立触手单位链跳过。" },
  { item: "DamageIncreaseTooltip旧展示树9至162", reason: "当前中文消费者使用完整TentacleDamageTotal9至180；旧展示树只作来源证据。" },
], [
  { item: "9至180角色等级中间曲线", reason: "插值算法未证，使用无默认实际输入。" },
  { item: "mCastTime与spellCastTime冲突", reason: "0.75秒和0.25秒同时存在，不任选。" },
], "按主负责人补充保留Q主动本体载体和9至180完整放大树；不把旧9至162展示树覆盖主动公式。");

define("Illaoi", "W", "严酷训诫", 5, (add, addF) => {
  add(spLevel("Illaoi", "W", "WMinDamage", 5, "w_min_damage", "强化普攻百分比伤害最低值", "INTEGER", "当前正文明确20/30/40/50/60；不是包含普攻本体的整击伤害。", 10));
  add(spLevel("Illaoi", "W", "HealthPercentDamage", 5, "health_percent_damage_points", "最大生命伤害百分数点", "DECIMAL", "当前正文消费3/3.5/4/4.5/5百分数点；公式外乘0.01转比例。", 20));
  add(spFixed("Illaoi", "W", "HealthDamageADRatio", "health_damage_ad_ratio", "最大生命伤害攻击力比例", "DECIMAL", "当前树为0.035×来源总攻击力，先与百分数点相加再乘0.01。", 30));
  add(fixed("percent_point_scale", "百分数点转比例", "DECIMAL", 0.01, "3百分数点转为0.03比例。", 40));
  add(spFixed("Illaoi", "W", "CooldownDuringR", "cooldown_during_r_ms", "R期间强化普攻冷却（毫秒）", "INTEGER", "跨技能正文消费2秒，转为毫秒。", 50, 1, toMs));
  add(spFixed("Illaoi", "W", "BuffDuration", "buff_duration_ms", "强化窗口（毫秒）", "INTEGER", "客户端原始6秒；主负责人要求标注消费依据。", 60, 1, toMs));
  add(spFixed("Illaoi", "W", "DashSpeedBonus", "dash_speed_bonus", "跃向目标的速度增量", "INTEGER", "来源DashSpeed为600；当前窄证为600+来源总移动速度。", 70));
  add(fixed("cast_time_ms", "根施法时间（毫秒）", "INTEGER", time("Illaoi", "W", "spellCastTime"), "唯一可用spellCastTime为0.25秒，转为毫秒。", 80));
  addF(formula("health_percent_ratio", "严酷训诫最大生命伤害比例", MUL(P("percent_point_scale"), ADD(P("health_percent_damage_points"), MUL(P("health_damage_ad_ratio"), AD()))), "0.01×(百分数点+0.035×来源总攻击力)。", 10));
  addF(formula("minimum_damage", "严酷训诫百分比伤害最低值", P("w_min_damage"), "单独保存最低值；实际伤害取最低值与目标最大生命×百分比公式的较大值。", 20));
  addF(formula("damage", "严酷训诫额外物理伤害", MAX(P("w_min_damage"), MUL(THP(), MUL(P("percent_point_scale"), ADD(P("health_percent_damage_points"), MUL(P("health_damage_ad_ratio"), AD()))))), "主负责人核对的MAX(最低值,目标最大生命×0.01×(百分数点+0.035×总攻击力))；不包含普攻本体。", 30));
  addF(formula("dash_speed", "严酷训诫跃向目标速度", ADD(P("dash_speed_bonus"), A("SOURCE", "move_speed", "TOTAL")), "当前窄证为600+来源总移动速度；不把350位移或显示400混为速度。", 40));
}, [
  { item: "附近触手自动猛击", reason: "独立触手单位链跳过。" },
  { item: "野怪伤害封顶300", reason: "兵野专用分支排除。" },
], [
  { item: "位移距离与目标资格", reason: "350位移、显示400与速度公式并存；距离和目标事件不扩展。" },
  { item: "位移距离和附近触手命中时序", reason: "只保留窄证速度公式；距离和命中事件待接。" },
], "保留本体强化普攻的最低值、目标最大生命比例和R期间2秒冷却；按MAX表达，排除触手单位。");

define("Illaoi", "E", "灵魂试炼", 5, (add, addF, w) => {
  // 灵魂替身、伤害转移、标记减速和触手间隔都属于本轮排除的独立链；只由通用资源参数承载技能槽。
}, [
  { item: "灵魂替身独立单位、伤害转移、标记减速和触手链", reason: "主负责人确认整条灵魂链按独立单位范围跳过；原始DataValues和计算树仍在来源摘要中。" },
], [
], [], "E技能槽只保留未复用的基础资源参数；灵魂全部新机制放入排除与原始来源，不写API。");

define("Illaoi", "R", "过界信仰", 3, (add, addF) => {
  add(spLevel("Illaoi", "R", "BaseDamage", 3, "base_damage", "本体大招基础物理伤害", "INTEGER", "来源150/250/350，技能等级1至3。", 10));
  add(spFixed("Illaoi", "R", "BuffRadius", "buff_radius", "强化范围", "INTEGER", "来源500；触手对象链不建立结果。", 20));
  add(spFixed("Illaoi", "R", "Duration", "buff_duration_ms", "强化持续（毫秒）", "INTEGER", "来源8秒转毫秒。", 30, 1, toMs));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", rawCoefficient("Illaoi", "R", "DamageCalc", 1), "当前树mStat2/mStatFormula2，系数0.5；按主负责人说明保留为额外攻击力。", 40));
  addF(formula("damage", "过界信仰本体物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), BAD())), "本体落地伤害=150/250/350+0.5×来源额外攻击力。", 10));
}, [
  { item: "触手生成、不可选取和加快猛击链", reason: "触手是独立单位属性，不能当作俄洛伊无敌或本体结果。" },
], [
  { item: "mCastTime与spellCastTime冲突", reason: "0.5秒和0.375秒并存，不任选。" },
], "保留R本体伤害与8秒强化窗口；触手生成及单位链排除，W期间2秒冷却已在W槽记录。");

// 孙悟空
define("MonkeyKing", "P", "金刚不坏", 1, (add, addF, w) => {
  add(runtime("bonus_armor_at_character_level", "等级护甲加成（实际输入）", "DECIMAL", "BonusArmor为6至10角色等级插值，中间算法未证；不带默认。", 10));
  add(spFixed("MonkeyKing", "P", "HealthPercentPer5", "health_percent_per_5_ratio", "每5秒最大生命回复比例", "DECIMAL", "来源0.0035，比例本身按1表示100%。", 20));
  add(spFixed("MonkeyKing", "P", "StackDuration", "stack_duration_ms", "额外层持续（毫秒）", "INTEGER", "来源5秒转毫秒。", 30, 1, toMs));
  add(spFixed("MonkeyKing", "P", "MaxStacks", "max_extra_stacks", "最多额外层数", "INTEGER", "最多5个额外层；基础层另计，最高为6倍。", 40));
  add(spFixed("MonkeyKing", "P", "StackMultiplier", "stack_multiplier", "每额外层基础倍率", "DECIMAL", "来源1，即每层增加100%基础效果。", 50));
  add(spFixed("MonkeyKing", "P", "CombatDuration", "combat_duration_ms", "战斗窗口（毫秒）", "INTEGER", "来源3秒转毫秒；触发资格事件待接。", 60, 1, toMs));
  add(spFixed("MonkeyKing", "P", "TooltipMult", "tooltip_multiplier", "展示护甲倍率", "INTEGER", "来源6；最高5额外层加基础层共6倍。", 70));
  add(fixed("health_regen_interval_ms", "生命回复间隔（毫秒）", "INTEGER", 5000, "当前中文正文明确每5秒。", 80));
  addF(formula("bonus_armor", "金刚不坏护甲加成", P("bonus_armor_at_character_level"), "角色等级护甲实际输入，不猜6至10之间的插值。", 10));
  addF(formula("tooltip_max_armor", "金刚不坏最高护甲展示值", MUL(P("bonus_armor_at_character_level"), P("tooltip_multiplier")), "完整基础层与5个额外层共6倍。", 20));
  addF(formula("health_regen_per_tick", "金刚不坏每次生命回复", MUL(P("health_percent_per_5_ratio"), HP()), "每5秒回复0.35%最大生命；触发事件待接。", 30));
  addF(formula("max_health_regen_per_tick", "金刚不坏满层每次生命回复", MUL(MUL(P("health_percent_per_5_ratio"), HP()), ADD(fixedParam("one"), MUL(P("stack_multiplier"), P("max_extra_stacks")))), "基础回复乘(1+5个额外层×100%)，最高为6倍基础。", 40));
  w.effects.push(attrEffect("self_bonus_armor", "金刚不坏自身护甲", "自身属性收益保留；等级实际值由运行输入提供。", { kind: "FORMULA", formulaKey: "bonus_armor" }, "armor", "attribute_flat_add", null, 100));
}, [
  { item: "野怪命中、分身命中和额外单位资格", reason: "本轮只保留本体对英雄命中的可核数值；野怪与分身分支排除。" },
], [
  { item: "6至10护甲中间等级曲线", reason: "插值算法未证，RUNTIME_INPUT无默认。" },
  { item: "基础层与额外层触发时序", reason: "本体事件待接；参数已明确最高6倍基础。" },
], "按主负责人说明保留每5秒回复、基础层加5个额外层的6倍和未知等级护甲输入。");

define("MonkeyKing", "Q", "粉碎打击", 5, (add, addF) => {
  add(spLevel("MonkeyKing", "Q", "BaseDamage", 5, "base_damage", "额外物理伤害基础值", "INTEGER", "来源20/45/70/95/120。", 10));
  add(spFixed("MonkeyKing", "Q", "ADRatio", "ad_ratio", "额外攻击力倍率", "DECIMAL", "主负责人核对为0.5×来源额外攻击力。", 20));
  add(spLevel("MonkeyKing", "Q", "ArmorShredPercent", 5, "armor_shred_ratio", "目标护甲降低比例", "DECIMAL", "来源10%至30%，数组本身已是0.10至0.30比例。", 30));
  add(spFixed("MonkeyKing", "Q", "ShredDuration", "shred_duration_ms", "护甲降低持续（毫秒）", "INTEGER", "3秒转毫秒。", 40, 1, toMs));
  add(spFixed("MonkeyKing", "Q", "BuffDuration", "buff_duration_ms", "强化攻击窗口（毫秒）", "INTEGER", "来源6秒，正文消费；触发/减冷却事件待接。", 50, 1, toMs));
  add(spLevel("MonkeyKing", "Q", "AttackRangeBonus", 5, "attack_range_bonus", "额外攻击距离", "INTEGER", "来源135/145/155/165/175。", 60));
  add(spFixed("MonkeyKing", "Q", "CooldownDecrease", "cooldown_decrease_ms", "命中后冷却减少（毫秒）", "INTEGER", "来源0.5秒转毫秒。", 70, 1, toMs));
  addF(formula("damage", "粉碎打击额外物理伤害", ADD(P("base_damage"), MUL(P("ad_ratio"), BAD())), "主负责人核对为基础值+0.5×来源额外攻击力。", 10));
  addF(formula("armor_shred_ratio", "粉碎打击护甲降低比例", P("armor_shred_ratio"), "只保留目标护甲降低来源比例；目标属性效果待接。", 20));
}, [
  { item: "分身独立攻击结果", reason: "本体Q数值保留；分身复制攻击链排除。" },
], [
  { item: "护甲降低作用对象和同次命中减冷却时序", reason: "来源数值明确，目标资格与事件层待接。" },
  { item: "mCastTime与spellCastTime冲突", reason: "0.5秒和0.25秒并存，不任选。" },
], "保留本体额外伤害、护甲降低比例、距离和命中减冷却数值；不把分身复制当作本体结果。");

define("MonkeyKing", "W", "真假猴王", 5, (add, addF) => {
  add(spLevel("MonkeyKing", "W", "StealthDuration", 5, "stealth_duration_ms", "本体隐身持续（毫秒）", "INTEGER", "来源1秒转毫秒。", 10, toMs));
  add(spFixed("MonkeyKing", "W", "DashSpeed", "dash_speed", "本体突进速度", "INTEGER", "来源900；分身独立分支排除。", 20));
  add(fixed("cast_time_ms", "根施法时间（毫秒）", "INTEGER", time("MonkeyKing", "W", "spellCastTime"), "根spellCastTime为0.25秒；不表示分身完成或命中时点。", 30));
}, [
  { item: "独立分身、分身攻击和模拟终极技能", reason: "自主分身整体跳过；本体隐身和突进保留。" },
  { item: "分身持续4秒、40%至60%伤害、几何范围", reason: "仅属于被排除分身/路径支路。" },
], [], "只保留本体隐身、突进速度和根施法时间；不扩展分身攻击链。");

define("MonkeyKing", "E", "腾云突击", 5, (add, addF, w) => {
  add(spLevel("MonkeyKing", "E", "BaseDamage", 5, "base_damage", "当前敌人基础魔法伤害", "INTEGER", "来源80/120/160/200/240。", 10));
  add(fixed("ap_ratio", "法强倍率", "DECIMAL", rawCoefficient("MonkeyKing", "E", "TotalDamage", 1), "当前树mCoefficient=1，按来源法强。", 20));
  add(spLevel("MonkeyKing", "E", "AttackSpeed", 5, "attack_speed_ratio", "自身攻击速度增加比例", "DECIMAL", "来源0.40至0.60，比例本身按1表示100%；属性增量用平加区。", 30));
  add(spFixed("MonkeyKing", "E", "AttackSpeedDuration", "attack_speed_duration_ms", "攻击速度持续（毫秒）", "INTEGER", "5秒转毫秒。", 40, 1, toMs));
  addF(formula("damage", "腾云突击当前敌人魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "本体当前敌人结果=基础值+1.0×法强。", 10));
  addF(formula("attack_speed_ratio", "腾云突击自身攻击速度增加", P("attack_speed_ratio"), "来源0.40至0.60直接是系统比例；效果使用attribute_flat_add。", 20));
  w.effects.push(attrEffect("self_attack_speed", "腾云突击自身攻击速度", "自身攻速增量保留；分身和额外敌人事件排除。", { kind: "FORMULA", formulaKey: "attack_speed_ratio" }, "bonus_attack_speed_percent", "attribute_flat_add", "attack_speed_duration_ms", 100));
}, [
  { item: "额外敌人分配和分身突进", reason: "本轮唯一敌方场景只保留本体当前敌人。" },
  { item: "野怪伤害倍率", reason: "兵野专用分支排除。" },
], [
  { item: "攻速效果实际应用对象", reason: "来源文本同时写本体和分身；分身排除后保留本体效果，事件层待接。" },
], "保留本体当前敌人伤害与自身攻速比例；使用比例属性平加区，不创建分身或额外敌人。");

define("MonkeyKing", "R", "大闹天宫", 3, (add, addF, w) => {
  add(spFixed("MonkeyKing", "R", "KnockupDuration", "knockup_duration_ms", "击飞持续（毫秒）", "INTEGER", "0.6秒转毫秒。", 10, 1, toMs));
  add(spFixed("MonkeyKing", "R", "SpinDuration", "spin_duration_ms", "旋转持续（毫秒）", "INTEGER", "2秒转毫秒。", 20, 1, toMs));
  add(spFixed("MonkeyKing", "R", "MoveSpeed", "move_speed_ratio", "自身移动速度增加比例", "DECIMAL", "来源0.2，即20%；比例属性使用平加区。", 30));
  add(spLevel("MonkeyKing", "R", "BasePercentMaxHPDmgPerSec", 3, "max_hp_damage_per_second_ratio", "目标最大生命每秒伤害比例", "DECIMAL", "来源2/4/6%，数组已转为0.02/0.04/0.06比例。", 40));
  add(spFixed("MonkeyKing", "R", "SecondsPerTick", "tick_interval_ms", "每次伤害间隔（毫秒）", "INTEGER", "0.25秒转毫秒。", 50, 1, toMs));
  add(spFixed("MonkeyKing", "R", "RecastWindow", "recast_window_ms", "重放窗口（毫秒）", "INTEGER", "8秒转毫秒。", 60, 1, toMs));
  add(spFixed("MonkeyKing", "R", "LockoutTimeBetweenCasts", "recast_lockout_ms", "重放锁定间隔（毫秒）", "INTEGER", "1秒转毫秒。", 70, 1, toMs));
  add(spFixed("MonkeyKing", "R", "ADRatioPerSecond", "ad_ratio_per_second", "每秒总攻击力倍率", "DECIMAL", "来源1.375×来源总攻击力。", 80));
  addF(formula("damage_per_second", "大闹天宫每秒物理伤害", ADD(MUL(P("max_hp_damage_per_second_ratio"), THP()), MUL(P("ad_ratio_per_second"), AD())), "每秒=目标最大生命×2/4/6%+1.375×来源总攻击力。", 10));
  addF(formula("damage_per_tick", "大闹天宫每跳物理伤害", MUL(ADD(MUL(P("max_hp_damage_per_second_ratio"), THP()), MUL(P("ad_ratio_per_second"), AD())), MUL(P("tick_interval_ms"), fixedParam("seconds_to_ms_inverse"))), "每0.25秒伤害=每秒整段×0.25；0.001为毫秒转秒。", 20));
  addF(formula("full_spin_damage", "大闹天宫完整一段物理伤害", MUL(ADD(MUL(P("max_hp_damage_per_second_ratio"), THP()), MUL(P("ad_ratio_per_second"), AD())), MUL(P("spin_duration_ms"), fixedParam("seconds_to_ms_inverse"))), "完整2秒=目标最大生命×8/12/16%+2.75×来源总攻击力。", 30));
  w.effects.push(attrEffect("self_move_speed", "大闹天宫自身移动速度", "自身移动速度增量使用move_speed_percent的平加区；旋转期间持续。", { kind: "PARAMETER", parameterKey: "move_speed_ratio" }, "move_speed_percent", "attribute_flat_add", "spin_duration_ms", 100));
}, [
  { item: "额外敌人和野怪封顶", reason: "本轮只保留同一敌人；野怪上限支路排除。" },
], [
  { item: "每跳与击飞事件的命中时序", reason: "完整数值已拆为每秒、每跳和整段公式，事件层待接。" },
  { item: "根施法字段", reason: "来源未提供可选施法字段，不从0推断。" },
], "按主负责人说明把目标最大生命比例纳入每秒、每跳和完整2秒公式；保留击飞、移速和重放时间。");

// 妮蔻
define("Neeko", "P", "天生幻魅", 1, (add) => {
  // 伪装/完整变形及其旧字段未被当前正文消费，保留范围结论而不把旧字段伪造成效果。
}, [
  { item: "完整伪装、属性复制和形态变形", reason: "自主完整变形范围跳过。" },
  { item: "客户端旧20%法穿、4秒、2秒字段", reason: "主负责人确认未消费，不录候选参数。" },
], [], "P槽只记录跳过完整伪装的范围，不创建未消费旧字段或伪装效果。");

define("Neeko", "Q", "盛开花种", 5, (add, addF) => {
  add(spLevel("Neeko", "Q", "ZoneDamage", 5, "zone_damage_base", "首段基础魔法伤害", "INTEGER", "来源60/110/160/210/260。", 10));
  add(spLevel("Neeko", "Q", "SecondaryDamage", 5, "secondary_damage_base", "后续绽放基础魔法伤害", "INTEGER", "来源35/60/85/110/135；最多两次后续。", 20));
  add(fixed("ap_ratio", "首段法强倍率", "DECIMAL", rawCoefficient("Neeko", "Q", "ExplosionDamage", 1), "当前树系数0.6。", 30));
  add(fixed("secondary_ap_ratio", "后续法强倍率", "DECIMAL", rawCoefficient("Neeko", "Q", "SecondDamage", 1), "当前树系数0.25。", 40));
  add(spFixed("Neeko", "Q", "RepeatDelay", "repeat_delay_ms", "后续绽放间隔（毫秒）", "INTEGER", "0.75秒转毫秒。", 50, 1, toMs));
  add(fixed("max_additional_blooms", "最多额外绽放次数", "INTEGER", 2, "当前中文正文明确最多额外盛开2次；同一敌人资格保留。", 60));
  add(fixed("cast_time_ms", "根施法时间（毫秒）", "INTEGER", time("Neeko", "Q", "spellCastTime"), "根spellCastTime为0.25秒。", 70));
  addF(formula("first_damage", "盛开花种首段魔法伤害", ADD(P("zone_damage_base"), MUL(P("ap_ratio"), AP())), "对应ExplosionDamage。", 10));
  addF(formula("repeat_damage", "盛开花种后续魔法伤害", ADD(P("secondary_damage_base"), MUL(P("secondary_ap_ratio"), AP())), "对应SecondDamage；同一敌人可重复命中，最多两次。", 20));
}, [
  { item: "兵野额外伤害和旧40%减速字段", reason: "兵野专用及未消费字段排除。" },
], [
  { item: "命中或击杀后的重复事件", reason: "同一敌人重复数值保留，目标仍在范围和事件层待接。" },
], "保留本体首段、后续两次同敌人绽放和0.75秒间隔；不把群体分配和兵野分支带入。");

define("Neeko", "W", "两生花影", 5, (add, addF, w) => {
  add(spLevel("Neeko", "W", "PassiveDamage", 5, "passive_damage_base", "第三次攻击基础魔法伤害", "INTEGER", "来源30/65/100/135/170。", 10));
  add(spFixed("Neeko", "W", "APRatio", "ap_ratio", "被动伤害法强倍率", "DECIMAL", "当前树NamedDataValue APRatio=0.6。", 20));
  add(spLevel("Neeko", "W", "PassiveHaste", 5, "passive_move_speed_points", "被动移速百分数点", "DECIMAL", "来源10/17.5/25/32.5/40百分数点；外层0.01转系统比例。", 30));
  add(fixed("passive_percent_scale", "被动移速百分数点转比例", "DECIMAL", 0.01, "百分数点到系统比例转换。", 40));
  add(spFixed("Neeko", "W", "PassiveHasteDuration", "passive_move_speed_duration_ms", "被动移速持续（毫秒）", "INTEGER", "1秒转毫秒。", 50, 1, toMs));
  add(spLevel("Neeko", "W", "Haste", 5, "active_move_speed_points", "主动移速百分数点", "DECIMAL", "来源20/25/30/35/40百分数点；外层0.01转系统比例。", 60));
  add(fixed("active_percent_scale", "主动移速百分数点转比例", "DECIMAL", 0.01, "百分数点到系统比例转换。", 70));
  add(spFixed("Neeko", "W", "HasteDuration", "active_move_speed_duration_ms", "主动移速持续（毫秒）", "INTEGER", "3秒转毫秒。", 80, 1, toMs));
  add(spFixed("Neeko", "W", "StealthDuration", "stealth_duration_ms", "本体隐身持续（毫秒）", "INTEGER", "0.5秒转毫秒；独立分身排除。", 90, 1, toMs));
  addF(formula("passive_damage", "两生花影第三击魔法伤害", ADD(P("passive_damage_base"), MUL(P("ap_ratio"), AP())), "对应PassiveBonusDamageCalc。", 10));
  addF(formula("passive_move_speed", "两生花影被动移速比例", MUL(P("passive_percent_scale"), P("passive_move_speed_points")), "第三次攻击后自身移速增量；属性使用平加区。", 20));
  addF(formula("active_move_speed", "两生花影主动移速比例", MUL(P("active_percent_scale"), P("active_move_speed_points")), "主动本体移速增量；分身不建结果。", 30));
  w.effects.push(attrEffect("self_passive_move_speed", "两生花影被动自身移动速度", "第三次攻击后的自身增益；触发由事件层接线。", { kind: "FORMULA", formulaKey: "passive_move_speed" }, "move_speed_percent", "attribute_flat_add", "passive_move_speed_duration_ms", 100));
  w.effects.push(attrEffect("self_active_move_speed", "两生花影主动自身移动速度", "主动本体自身增益；分身和镜像链排除。", { kind: "FORMULA", formulaKey: "active_move_speed" }, "move_speed_percent", "attribute_flat_add", "active_move_speed_duration_ms", 110));
}, [
  { item: "独立分身、镜像施法和兵野额外伤害", reason: "完整分身单位和兵野分支跳过；本体隐身、第三击和移速保留。" },
], [
  { item: "第三击触发和隐身可选取规则", reason: "候选保留数值和本体效果，事件层待接。" },
], "保留本体第三击、被动/主动移速和隐身；所有百分数点先转系统比例再以attribute_flat_add增加。");

define("Neeko", "E", "缠结倒刺", 5, (add, addF) => {
  add(spLevel("Neeko", "E", "Damage", 5, "damage_base", "首个目标基础魔法伤害", "INTEGER", "来源70/105/140/175/210。", 10));
  add(fixed("ap_ratio", "法强倍率", "DECIMAL", rawCoefficient("Neeko", "E", "BaseDamage", 1), "当前树系数0.65。", 20));
  add(spLevel("Neeko", "E", "MinRootDuration", 5, "min_root_duration_ms", "首个目标禁锢持续（毫秒）", "INTEGER", "当前正文首个目标为0.7/0.9/1.1/1.3/1.5秒，转为毫秒。", 30, toMs));
  add(fixed("cast_time_ms", "根施法时间（毫秒）", "INTEGER", time("Neeko", "E", "spellCastTime"), "根spellCastTime为0.25秒。", 60));
  addF(formula("damage", "缠结倒刺本体魔法伤害", ADD(P("damage_base"), MUL(P("ap_ratio"), AP())), "对应BaseDamage；本轮只保留首个目标。", 10));
  addF(formula("first_target_root_duration", "缠结倒刺首个目标禁锢", P("min_root_duration_ms"), "首个目标第一次命中使用最小禁锢；强化后续目标需要额外敌人，排除。", 20));
}, [
  { item: "额外敌人强化禁锢1.8至3秒", reason: "主负责人确认需先前额外敌人，本轮唯一敌方场景排除该支路。" },
  { item: "旧BaseRootDuration0.5秒", reason: "当前正文未消费为首个目标结果。" },
], [
  { item: "沿途控制和命中事件", reason: "首个目标伤害与最小禁锢保留，事件层待接。" },
], "按主负责人说明首个目标只用0.7至1.5秒最小禁锢，额外敌人强化值仅在来源摘要与排除中出现。");

define("Neeko", "R", "怒放", 3, (add, addF) => {
  add(spLevel("Neeko", "R", "Damage", 3, "damage_base", "本体基础魔法伤害", "INTEGER", "来源150/350/550。", 10));
  add(fixed("ap_ratio", "法强倍率", "DECIMAL", rawCoefficient("Neeko", "R", "TotalDamage", 1), "当前树系数1.2。", 20));
  add(spFixed("Neeko", "R", "DelayUntilExplosion", "delay_until_explosion_ms", "落地前击飞延迟（毫秒）", "INTEGER", "来源0.6秒转毫秒；当前正文称先击飞再落地。", 30, 1, toMs));
  add(spFixed("Neeko", "R", "StunDuration", "stun_duration_ms", "落地眩晕持续（毫秒）", "INTEGER", "0.75秒转毫秒。", 40, 1, toMs));
  add(spFixed("Neeko", "R", "DelayBeforePassiveRemoval", "passive_removal_delay_ms", "施放后解除伪装延迟（毫秒）", "INTEGER", "0.5秒转毫秒；伪装主体链排除，保留明确时长。", 50, 1, toMs));
  addF(formula("damage", "怒放本体魔法伤害", ADD(P("damage_base"), MUL(P("ap_ratio"), AP())), "对应TotalDamage；保留本体唯一敌方伤害数值。", 10));
}, [
  { item: "额外敌人范围、护盾及按人数放大", reason: "主负责人确认当前正文未消费护盾树，不录ShieldAmount/ShieldPerChampion支路。" },
  { item: "伪装隐藏前摇", reason: "依赖已排除的完整伪装链。" },
], [
  { item: "Duration2.5秒字段", reason: "当前正文没有把它作为控制时长，保留原始摘要不转成控制。" },
  { item: "击飞到落地的事件时序", reason: "延迟和眩晕数值保留，事件层待接。" },
], "保留R本体伤害、击飞延迟、眩晕和解除伪装延迟；不录未消费护盾或伪装链。");

// 悠米
define("Yuumi", "P", "猫的博爱", 1, (add, addF) => {
  add(runtime("heal_base_at_character_level", "命中治疗角色等级基础值（实际输入）", "DECIMAL", "HealAmount为20至110角色等级插值，中间曲线未知；不带默认。", 10));
  add(fixed("heal_ap_ratio", "治疗法强倍率", "DECIMAL", rawCoefficient("Yuumi", "P", "HealAmount", 1), "当前HealAmount系数0.3。", 40));
  add(runtime("passive_cooldown_at_character_level", "被动冷却角色等级值（实际输入）", "DECIMAL", "起点20秒、逐级减1且14级空断点；断点后算法未知，不造18级映射。", 50));
  add(fixed("passive_cooldown_level1_ms", "被动冷却一级值（毫秒）", "INTEGER", 20000, "来源PassiveCooldown树一级20秒；仅保存已知起点。", 60));
  addF(formula("heal_amount", "猫的博爱自身治疗量", ADD(P("heal_base_at_character_level"), MUL(P("heal_ap_ratio"), AP())), "20至110角色等级基础实际输入+0.3×来源法强；自身治疗明确，附身友军转移另列待核。", 10));
}, [
  { item: "附身友军治疗转移、友军4秒窗口和友谊成长", reason: "第三友方资格与自动触发链排除；友军4秒窗口只在原始来源中保留，不一概含或不含自身。" },
  { item: "未消费PityTimer6秒", reason: "当前根说明未消费该字段；仅随原始来源留档，不创建候选参数或时序。" },
], [
  { item: "20秒起点、14级断点后的冷却曲线", reason: "原树断点后算法未证，RUNTIME_INPUT无默认。" },
], "按主负责人说明只录自身治疗；附身友军4秒窗口与未消费PityTimer仅在原始来源和排除中保留，角色等级基础和被动冷却曲线均不猜。");

define("Yuumi", "Q", "摸鱼飞弹", 6, (add, addF) => {
  add(spLevel("Yuumi", "Q", "MissileDamage", 6, "missile_damage_base", "普通飞弹基础魔法伤害", "INTEGER", "悠米Q最高六级，来源60/95/130/165/200/235。", 10));
  add(spFixed("Yuumi", "Q", "APRatio", "ap_ratio", "普通飞弹法强倍率", "DECIMAL", "当前树系数0.2。", 20));
  add(spLevel("Yuumi", "Q", "EmpoweredMissileDamage", 6, "empowered_damage_base", "强化飞弹基础魔法伤害", "INTEGER", "来源80/135/190/245/300/355；强化资格依附状态待核。", 30));
  add(spFixed("Yuumi", "Q", "EmpoweredAPRatio", "empowered_ap_ratio", "强化飞弹法强倍率", "DECIMAL", "当前树系数0.3。", 40));
  add(spFixed("Yuumi", "Q", "SlowAmount", "slow_percent_points", "普通减速百分数点", "INTEGER", "当前正文消费20%；源字段SlowDuration另存于待核说明。", 50));
  add(spLevel("Yuumi", "Q", "EmpoweredSlowAmount", 6, "empowered_slow_percent_points", "强化减速百分数点", "INTEGER", "来源50/53/56/59/62/65；强化资格待核。", 60));
  add(spFixed("Yuumi", "Q", "EmpoweredSlowDuration", "empowered_slow_duration_ms", "强化减速持续（毫秒）", "INTEGER", "2秒转毫秒；当前正文明确强化分支。", 70, 1, toMs));
  add(spFixed("Yuumi", "Q", "TimeToAfterburners", "afterburner_time_ms", "提速前导引时间（毫秒）", "INTEGER", "1.35秒转毫秒；附身导引资格待核。", 80, 1, toMs));
  add(spFixed("Yuumi", "Q", "MissileLifetime", "missile_lifetime_ms", "飞弹寿命（毫秒）", "INTEGER", "1.85秒转毫秒；根施法0不代表弹道瞬达。", 90, 1, toMs));
  add(fixed("cast_time_ms", "根施法时间（毫秒）", "INTEGER", time("Yuumi", "Q", "spellCastTime"), "根spellCastTime为0，仅表示施法阶段字段。", 100));
  addF(formula("normal_damage", "摸鱼飞弹普通魔法伤害", ADD(P("missile_damage_base"), MUL(P("ap_ratio"), AP())), "普通首个命中目标伤害。", 10));
  addF(formula("empowered_damage", "摸鱼飞弹强化魔法伤害", ADD(P("empowered_damage_base"), MUL(P("empowered_ap_ratio"), AP())), "强化飞弹伤害；附身资格不在独立1V1场景中擅自开启。", 20));
}, [
  { item: "挚友对第三友军附加伤害、暴击增幅", reason: "第三友军资格排除。" },
], [
  { item: "附身导引和强化飞弹资格", reason: "当前文本将导引/强化放在附身条件中，不能按旧摘要无条件启用。" },
  { item: "普通减速持续1秒", reason: "源字段明确但正文未消费，保留范围说明不创建独立时序。" },
], "按主负责人核对以最高六级录入普通和强化伤害；强化条件、第三友军附伤和普通减速时长分开待核/排除。");

define("Yuumi", "W", "悠米出动！", 5, (add, addF) => {
  // 附身、不可选取、挚友治疗护盾强度和友军命中治疗全部属于第三友军链，本轮不写API。
}, [
  { item: "附身主动链、不可选取、挚友强化和第三友军治疗", reason: "主负责人确认整槽依赖第三友军；附身冷却、锁定、强度和治疗只在原始来源摘要中保留。" },
], [
], [], "W技能槽不建立附身或友军治疗请求；完整客户端数值仍随原始来源摘要留档。");

define("Yuumi", "E", "旺盛精力", 5, (add, addF, w) => {
  add(spLevel("Yuumi", "E", "BaseShielding", 5, "shield_base", "自身基础护盾", "INTEGER", "来源65/90/115/140/165。", 10));
  add(spFixed("Yuumi", "E", "APRatio", "shield_ap_ratio", "护盾法强倍率", "DECIMAL", "当前TotalShielding树系数0.4。", 20));
  add(spLevel("Yuumi", "E", "AttackSpeedAmount", 5, "attack_speed_points", "攻击速度百分数点", "DECIMAL", "来源25/27.5/30/32.5/35百分数点；需乘0.01转系统比例。", 30));
  add(fixed("attack_speed_percent_scale", "攻击速度百分数点转比例", "DECIMAL", 0.01, "百分数点到系统比例转换。", 40));
  add(spFixed("Yuumi", "E", "MSAmount", "move_speed_points", "移动速度百分数点", "INTEGER", "来源20百分数点；需乘0.01转系统比例。", 50));
  add(fixed("move_speed_percent_scale", "移动速度百分数点转比例", "DECIMAL", 0.01, "百分数点到系统比例转换。", 60));
  add(spFixed("Yuumi", "E", "MSDuration", "attack_speed_duration_ms", "攻速持续（毫秒）", "INTEGER", "当前正文明确攻速持续3秒；不据此推断护盾寿命。", 70, 1, toMs));
  add(fixed("attack_speed_ap_points_ratio", "攻击速度法强百分数点倍率", "DECIMAL", rawCoefficient("Yuumi", "E", "TotalAttackSpeed", 1), "当前树系数0.08，单位为每点法强增加的百分数点。", 75));
  addF(formula("shield_value", "旺盛精力自身护盾值", ADD(P("shield_base"), MUL(P("shield_ap_ratio"), AP())), "对应TotalShielding；附身转给第三友军的分支排除。", 10));
  addF(formula("attack_speed_ratio", "旺盛精力自身攻击速度增加", MUL(P("attack_speed_percent_scale"), ADD(P("attack_speed_points"), MUL(P("attack_speed_ap_points_ratio"), AP()))), "攻击速度=(25/27.5/30/32.5/35+0.08×法强)×0.01；效果使用bonus_attack_speed_percent的平加区。", 20));
  addF(formula("move_speed_ratio", "旺盛精力自身移动速度增加", MUL(P("move_speed_percent_scale"), P("move_speed_points")), "20百分数点×0.01=0.2系统比例。", 30));
  w.effects.push(shieldEffect("self_shield", "旺盛精力自身普通护盾", "未附身时自身护盾保留；护盾寿命未从3秒攻速时长推断。", "shield_value", null, 100));
  w.effects.push(attrEffect("self_attack_speed", "旺盛精力自身攻击速度", "正文明确3秒攻速；效果值已由百分数点转系统比例。", { kind: "FORMULA", formulaKey: "attack_speed_ratio" }, "bonus_attack_speed_percent", "attribute_flat_add", "attack_speed_duration_ms", 110));
  w.effects.push(attrEffect("self_move_speed", "旺盛精力自身移动速度", "移动速度仅在护盾存留时有效；护盾寿命与移速联动待接。", { kind: "FORMULA", formulaKey: "move_speed_ratio" }, "move_speed_percent", "attribute_flat_add", null, 120));
}, [
  { item: "附身后第三友军护盾、攻速、移速和回蓝", reason: "第三友军资格排除；不把附身分支混入自身效果。" },
  { item: "根cooldownTime缺失与官方10秒冷却", reason: "客户端根字段没有可用冷却，官方10秒与源弹药/充能18至14秒冲突；不补、不覆盖。" },
  { item: "弹药/充能18至14秒", reason: "与官方10秒不一致，未录为冷却或弹药参数。" },
], [
  { item: "护盾寿命与移速结束联动", reason: "当前3秒只明确攻速持续，护盾生命周期未证。" },
  { item: "根施法0", reason: "只作施法字段来源，不推断护盾寿命或弹道时点。" },
], "严格按主负责人说明：护盾与攻速数值保留，但3秒只给攻速；攻速百分数点先转比例并用平加区，附身第三友军和回蓝排除。");

define("Yuumi", "R", "魔典终章", 3, (add, addF) => {
  add(spLevel("Yuumi", "R", "BaseMissileDamage", 3, "base_missile_damage", "首波基础魔法伤害", "INTEGER", "来源75/125/175。", 10));
  add(fixed("ap_ratio", "波纹法强倍率", "DECIMAL", rawCoefficient("Yuumi", "R", "TotalMissileDamage", 1), "当前树系数0.25。", 20));
  add(spFixed("Yuumi", "R", "MultiMissileReduction", "subsequent_wave_multiplier", "后续波纹伤害倍率", "DECIMAL", "来源0.25；同一敌人后续每波使用整段25%。", 30));
  add(spFixed("Yuumi", "R", "CCDuration", "slow_duration_ms", "减速持续（毫秒）", "INTEGER", "1.25秒转毫秒；当前中文正文只写减速，不创建禁锢。", 40, 1, toMs));
  add(spFixed("Yuumi", "R", "UltDuration", "channel_duration_ms", "引导持续（毫秒）", "INTEGER", "3.5秒转毫秒。", 50, 1, toMs));
  add(spFixed("Yuumi", "R", "NumberOfWaves", "wave_count", "波纹数量", "INTEGER", "来源5。", 60));
  add(spFixed("Yuumi", "R", "TimeBetweenWaves", "wave_interval_ms", "波纹间隔（毫秒）", "INTEGER", "0.75秒转毫秒。", 70, 1, toMs));
  add(spLevel("Yuumi", "R", "BaseHealPerWave", 3, "heal_base_per_wave", "每波基础治疗", "INTEGER", "来源30/50/70；友军资格待核。", 80));
  add(fixed("heal_ap_ratio", "每波治疗法强倍率", "DECIMAL", rawCoefficient("Yuumi", "R", "TotalHealPerWave", 1), "当前树系数0.12。", 90));
  add(spFixed("Yuumi", "R", "BaseSlow", "base_slow_ratio", "首波减速源比例", "DECIMAL", "来源-0.1；文本转正显示10%，叠层起算待核。", 100));
  add(spFixed("Yuumi", "R", "BonusSlowPerWave", "bonus_slow_per_wave_ratio", "每后续波减速增加源比例", "DECIMAL", "来源-0.1；文本转正显示每波10%。", 110));
  add(fixed("slow_source_sign", "减速源值转正符号", "DECIMAL", -1, "BaseSlow和BonusSlowPerWave为负源值，显示效果使用乘-1；只记录来源口径。", 130));
  addF(formula("missile_damage", "魔典终章单波魔法伤害", ADD(P("base_missile_damage"), MUL(P("ap_ratio"), AP())), "对应TotalMissileDamage。", 10));
  addF(formula("subsequent_wave_damage", "魔典终章后续波纹同敌人伤害", MUL(ADD(P("base_missile_damage"), MUL(P("ap_ratio"), AP())), P("subsequent_wave_multiplier")), "后续波纹对同一敌人的整段25%伤害。", 20));
  addF(formula("single_target_total_damage", "魔典终章同敌人完整伤害", MUL(ADD(P("base_missile_damage"), MUL(P("ap_ratio"), AP())), ADD(fixedParam("one"), MUL(SUB(P("wave_count"), fixedParam("one")), P("subsequent_wave_multiplier")))), "5波同一敌人最大值=首波×(1+4×0.25)=2倍；没有禁锢结果。", 30));
  addF(formula("heal_per_wave", "魔典终章每波友军治疗", ADD(P("heal_base_per_wave"), MUL(P("heal_ap_ratio"), AP())), "友军治疗来源公式；自身是否合资格待核。", 40));
}, [
  { item: "WavesToRoot三波禁锢", reason: "固定16.17.1当前官方技能说明与官方2023重做说明共同支持重做后已移除禁锢；旧WavesToRoot未消费，不采纳三波禁锢。" },
  { item: "挚友第三友军治疗和溢出护盾", reason: "第三友军资格未证，独立场景不创建治疗/护盾结果。" },
  { item: "AllyHealingPerc增强友军治疗比例与公式", reason: "主负责人确认增强友军治疗比例和公式本轮排除；仅随原始来源留档。" },
  { item: "额外1.5秒护盾持续", reason: "未消费字段，不猜。" },
], [
  { item: "减速叠层起算", reason: "源值和文本方向明确，但第一波是否即加成待消费资格核对。" },
  { item: "引导期间移动、E和波纹锁定方向", reason: "行为时序待接；根施法0不推断瞬发。" },
], "按主负责人修正只记录减速，不记录旧三波禁锢；同一敌人五波伤害和基础治疗来源保留，增强友军治疗比例与公式分开排除。");

function fixedParam(key) {
  // 表达式只能引用参数；这些通用常量由每个需要它的技能显式补入。
  return P(key);
}

// 显式补入公式使用的通用常量，避免表达式出现非参数常量节点。
const ensureConstant = (skillKey, key, value, description, sortOrder) => {
  const params = defs[skillKey].write.parameters;
  if (!params.some(item => item.parameterKey === key)) params.push(fixed(key, key === "one" ? "单位一" : key === "one_hundredth" ? "百分之一" : "毫秒转秒比例", "DECIMAL", value, description, sortOrder));
};
ensureConstant("illaoi_q", "one", 1, "公式常量；不表示业务默认输入。", 1000);
ensureConstant("monkeyking_p", "one", 1, "公式常量；不表示业务默认输入。", 1000);
ensureConstant("monkeyking_r", "seconds_to_ms_inverse", 0.001, "毫秒转秒的固定换算比例。", 1000);
ensureConstant("yuumi_r", "one", 1, "公式常量；不表示业务默认输入。", 1000);

const order = [
  "illaoi_p", "illaoi_q", "illaoi_w", "illaoi_e", "illaoi_r",
  "monkeyking_p", "monkeyking_q", "monkeyking_w", "monkeyking_e", "monkeyking_r",
  "neeko_p", "neeko_q", "neeko_w", "neeko_e", "neeko_r",
  "yuumi_p", "yuumi_q", "yuumi_w", "yuumi_e", "yuumi_r",
];
assert(Object.keys(defs).length === 20, "技能槽不是20个");
for (const skillKey of order) {
  assert(defs[skillKey].maxLevel === defs[skillKey].source.officialMaxRank, "技能最高等级不一致：" + skillKey);
  for (const item of defs[skillKey].write.parameters) {
    if (item.valueMode === "RUNTIME_INPUT") assert(item.fixedValue === null && item.levelValues === null, "运行输入带默认：" + skillKey + "/" + item.parameterKey);
    if (item.valueType === "INTEGER") {
      const values = item.valueMode === "FIXED" ? [item.fixedValue] : item.valueMode === "SKILL_LEVEL" || item.valueMode === "CHARACTER_LEVEL" ? Object.values(item.levelValues || {}) : [];
      assert(values.every(value => Number.isInteger(value) && value >= 0), "整数参数非法：" + skillKey + "/" + item.parameterKey);
    }
    if (item.valueMode === "SKILL_LEVEL") assert(Object.keys(item.levelValues || {}).length === defs[skillKey].maxLevel, "技能等级数组不完整：" + skillKey + "/" + item.parameterKey);
    if (item.valueMode === "CHARACTER_LEVEL") assert(Object.keys(item.levelValues || {}).length === 18, "角色等级数组不完整：" + skillKey + "/" + item.parameterKey);
  }
  for (const item of defs[skillKey].write.formulas) {
    const walk = node => {
      assert(node && typeof node === "object", "空公式节点：" + skillKey + "/" + item.formulaKey);
      if (node.nodeType === "OPERATION") { assert(Array.isArray(node.operands) && node.operands.length === 2, "公式不是双目：" + skillKey + "/" + item.formulaKey); walk(node.operands[0]); walk(node.operands[1]); }
      else if (node.nodeType === "PARAMETER") assert(defs[skillKey].write.parameters.some(p => p.parameterKey === node.parameterKey) || reuseSet.has(skillKey + "/" + node.parameterKey), "公式引用参数不存在：" + skillKey + "/" + node.parameterKey);
      else if (node.nodeType === "ATTRIBUTE") return;
      else throw new Error("未知公式节点：" + skillKey + "/" + item.formulaKey);
    };
    walk(item.expression);
  }
}

const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const routes = { parameters: "parameters", formulas: "formulas", effects: "effects", processes: "processes", internalStates: "internal-states", triggerRules: "trigger-rules" };
const keys = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" };
const writes = order.flatMap(skillKey => kinds.flatMap(kind => defs[skillKey].write[kind].map(body => ({ skillKey, kind, body }))));
const requestCounts = Object.fromEntries(kinds.map(kind => [kind, writes.filter(item => item.kind === kind).length]));
const publicReuse = reuseList.map(item => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false }));
const requests = writes.map((item, index) => {
  const stableKey = item.body[keys[item.kind]];
  assert(stableKey, "缺少稳定键：" + item.skillKey + "/" + item.kind);
  return { sequence: index + 1, method: "POST", route: "/skills/" + item.skillKey + "/" + routes[item.kind], detailRoute: "/skills/" + item.skillKey + "/" + routes[item.kind] + "/" + stableKey, skillKey: item.skillKey, kind: item.kind, stableKey, status: "仅意图，未调用", body: item.body };
});
const protectedCounts = { GETs: snapshot.GETs, subjects: order.length, currentCompositionSkillSlots: order.length, currentCompositionLists: order.length * 6, reusedPublicParameters: reuseList.length, images: order.length, characters: binding.heroes.length, characterSkillRelations: binding.heroes.length, dictionaries: 4 };
const protectedRoutes = [...new Set((snapshot.requests || []).map(item => item.route))];
const protectedObjects = {
  subjects: order.map(skillKey => ({ skillKey, route: "/skills/" + skillKey, data: defs[skillKey].currentSubject, dataSha256: sha256(JSON.stringify(defs[skillKey].currentSubject)) })),
  currentCompositionLists: order.map(skillKey => ({ skillKey, routes: kinds.map(kind => "/skills/" + skillKey + "/" + routes[kind]), sourceSnapshot: "输入包/参考资料/当前20槽保护快照.json" })),
  reusedPublicParameters: publicReuse, protectedReferenceRequests: snapshot.requests, protectedReferenceRoutes: protectedRoutes, protectedReferenceCounts: protectedCounts,
  scope: "20个技能槽主体、六类组成、代表图、角色关系、字典与26个公共参数均为保护对象。", snapshotFile: "输入包/参考资料/当前20槽保护快照.json", snapshotSha256: shaFile(snapshotFile),
};
const counts = { newParameters: requestCounts.parameters, newFormulas: requestCounts.formulas, newEffects: requestCounts.effects, newProcesses: requestCounts.processes, newInternalStates: requestCounts.internalStates, newTriggerRules: requestCounts.triggerRules, newTotal: requests.length, reusedPublicParameters: reuseList.length, plannedTotalIncludingReused: requests.length + reuseList.length, protectedCurrentCompositionLists: protectedCounts.currentCompositionLists };
const selectedValues = Object.fromEntries(order.map(skillKey => {
  const skill = defs[skillKey];
  return [skillKey, { binding: skill.source.spellPath, officialMaxRank: skill.maxLevel, rawDataValues: skill.source.raw.dataValues, rawFields: skill.source.raw.fields, calculations: skill.source.raw.calculations, selectedParameters: skill.write.parameters.map(item => ({ parameterKey: item.parameterKey, name: item.name, valueType: item.valueType, valueMode: item.valueMode, fixedValue: item.fixedValue, levelValues: item.levelValues })), formulas: skill.write.formulas.map(item => ({ formulaKey: item.formulaKey, expression: item.expression })), excluded: skill.excluded, pending: skill.pending }];
}));
const sourceNotes = {
  arrayIndex: "技能等级数组统一读取DataValues索引1至最高等级；悠米Q明确按1至6，源树索引0只保留其原义。",
  selector: "当前绑定树按窄口径使用SOURCE/TARGET属性节点；mStat2同版本具名树按主负责人说明解释为总攻击力或额外攻击力，并保留来源限定。",
  operations: "每个OPERATION严格两个操作数；MAX用于俄洛伊W最低值与目标最大生命结果比较，毫秒换算常量也以参数节点进入。",
  resources: "26个公共冷却/法力参数只复用；未在复用清单且有实际资源消耗的技能使用官方16.17.1等级数组新增；无消耗全零数组不生成为零参数，悠米E官方10秒冷却因根字段冲突留在排除；请求计划全部未执行。",
  timing: "只保存明确且不冲突的时间；冲突施法字段、引导与护盾寿命不任选、不补零。",
  percentages: "move_speed_percent、bonus_attack_speed_percent以及治疗护盾强度等比例属性按1表示100%；百分数点先乘0.01，增量结果使用attribute_flat_add。",
  semantics: "保留本体Q/W/R、同一敌人重复波纹/绽放、主体护盾和属性收益；独立召唤、分身、完整变形、额外敌人、第三友军和兵野专用支路分开排除或待核。",
  yuumiRControlEvidence: "固定16.17.1当前官方技能说明与官方2023重做说明共同支持悠米R重做后已移除禁锢；客户端旧WavesToRoot=3未消费，因此只保留减速和五波数值。",
  principalSupplement: "输入包/主负责人源值核对说明.md已在冻结前纳入；其中纠正悠米Q六级、R仅减速、E护盾寿命、俄洛伊Q主动载体、妮蔻E首个目标和孙悟空P六倍等关键口径。",
};
const sourceValues = { generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, status: "独立原始源值摘要；未调用业务接口", sourceVersion: SOURCE_VERSION, sourceInputSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), sourceReview, inputIntegrity: Object.fromEntries(Object.entries(sourceFiles).map(([file, info]) => [file, info.sha256])), principalSourceNoteSha256: shaFile(sourceNoteFile), selectedValues, noApiCalls: true };
const candidate = {
  meta: { generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, status: "候选已生成，等待主负责人审查；未调用业务接口", gameId: "lol", apiBase: API_BASE, sourceVersion: SOURCE_VERSION, scope: "俄洛伊、孙悟空、妮蔻、悠米20个技能槽；唯一敌方一对一，保留本体伤害、同一敌人重复、主体护盾和自身属性收益。", sourcePolicy: "固定客户端16.17、官方16.17.1、当前中文绑定正文和主负责人逐槽源值说明；未知曲线、资格与时序无默认。", inputPackage: ".agents/artifacts/hero44-root-entry-20260910", currentSnapshot: "输入包/参考资料/当前20槽保护快照.json", currentSnapshotSha256: shaFile(snapshotFile), sourceInputSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), principalSourceNoteSha256: shaFile(sourceNoteFile), sourceReview, businessWrites: 0, apiCalls: 0, tokenStored: false, candidateFileSha256: null },
  skills: defs, order, reusedPublicParameters: publicReuse, reusedExistingParameters: publicReuse, counts, apiWrites: 0, sourceFiles, sourceNotes, protectedObjects,
};
const candidateBytes = JSON.stringify(candidate, null, 2) + "\n";
const candidateSha256 = sha256(candidateBytes);
const plan = { generatedAt: new Date().toISOString(), status: "仅写入意图，未调用业务接口；候选等待主负责人审查", batch: BATCH, revision: REVISION, apiBase: API_BASE, sourceVersion: SOURCE_VERSION, candidateSha256, sourceInputSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), principalSourceNoteSha256: shaFile(sourceNoteFile), sourceReview, protectionSnapshotSha256: shaFile(snapshotFile), publicReuseSha256: shaFile(reuseFile), requestCount: requests.length, requestCounts, currentTotalComponents: requests.length + reuseList.length, currentCompositionListsProtected: protectedCounts.currentCompositionLists, reusedPublicParameters: publicReuse, protectedSkills: order, protectedCounts, protectedRoutes, requests, noApiCalls: true, apiWrites: 0 };
const planBytes = JSON.stringify(plan, null, 2) + "\n";
const planSha256 = sha256(planBytes);
const sourceValuesBytes = JSON.stringify(sourceValues, null, 2) + "\n";
const sourceValuesSha256 = sha256(sourceValuesBytes);
const sourceHashes = { generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, inputPackage: ".agents/artifacts/hero44-root-entry-20260910", sourceFiles, frozenHashes: { inputVersionSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), protectionSnapshotSha256: shaFile(snapshotFile), publicReuseSha256: shaFile(reuseFile), attributeBoundarySha256: shaFile(attributeFile), payloadSampleSha256: shaFile(payloadFile), cursorReviewSha256: sourceReview.conclusionSha256, cursorAuditSha256: sourceReview.auditSha256, cursorInputManifestSha256: sourceReview.inputManifestSha256, rangeDocSha256: shaFile(rangeFile), sourceNoteSha256: shaFile(sourceNoteFile), ...(fs.existsSync(supplementFile) ? { cursorSupplementSha256: shaFile(supplementFile) } : {}) }, outputs: { candidateSha256, planSha256, sourceValuesSha256 }, apiCalls: 0, apiWrites: 0 };
const version = { generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, status: "candidate", candidateSha256, planSha256, sourceValuesSha256, counts, requestCount: requests.length, sourceReview, principalSourceNoteSha256: shaFile(sourceNoteFile), apiCalls: 0, apiWrites: 0 };
const sourceScope = { generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, status: "候选阶段，未调用业务接口", sourceVersion: SOURCE_VERSION, sourceInputSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), principalSourceNoteSha256: shaFile(sourceNoteFile), sourceReview, included: ["俄洛伊P/Q/W/R：本体主动Q载体、W最低值与目标最大生命伤害、R本体伤害和自身治疗；E灵魂链只在原始来源中核对。", "孙悟空P/Q/W/R：本体护甲和回复、同敌人附加伤害、隐身突进、R同敌人每跳/整段伤害和移速；E本体当前敌人和攻速。", "妮蔻P/Q/W/E/R：跳过完整伪装，保留本体种子重复、第三击、移速、首个目标禁锢和R本体控制/伤害。", "悠米P/Q/R：自身治疗、Q六级普通/强化来源、R同敌人五波伤害和基础治疗来源；W整槽附身链排除，E保留未附身自身护盾和攻移速。"], excluded: ["经验金币、纯兵野结果、额外敌人、独立触手/分身/完整变形、第三友军执行结果、旧未消费护盾/禁锢/法穿字段。", "不创建DAMAGE、DIRECT_HEAL、MOMENT_EVALUATION、过程、内部状态或触发规则；伤害与治疗以候选公式或原始来源摘要表达。"], unknown: ["角色等级插值中间曲线、目标/友军资格、周期事件、冲突施法字段、悠米护盾寿命联动、波纹减速叠层起算"], perSkill: Object.fromEntries(order.map(skillKey => [skillKey, { excluded: defs[skillKey].excluded, pending: defs[skillKey].pending }])), counts, requestCount: requests.length, publicReuse: reuseList.length, protectedSummary: protectedCounts, noApiCalls: true };
let experience = ["# 第四十四批体验记录", "", "本批只生成静态候选和POST请求计划，未调用业务接口。20个技能槽主体、六类组成、代表图、角色关系、字典和26个公共参数受输入快照保护。", "", "- 俄洛伊：Q主动本体载体保留完整9至180放大树；W用最低值与目标最大生命公式取大；E灵魂整条新链只留来源证据；P只保留自身治疗和触发缺值。", "- 孙悟空：P护甲曲线不猜但明确基础层加5个额外层为最高6倍；Q/E只保留本体和同敌人；R把目标最大生命比例纳入每秒、每跳和完整两秒。", "- 妮蔻：完整伪装和分身跳过；Q保留同一敌人后续绽放；E首个目标使用最小禁锢，额外敌人强化只留来源；R不录旧护盾。", "- 悠米：Q按六级；W整槽附身和友军链排除；P只保留自身治疗；E的3秒只作用于攻速，护盾寿命未由此推断；R只有五波同一敌人伤害与基础治疗，友军增强和三波禁锢排除。", "", "未知曲线、资格、控制和护盾时序均写入来源与范围；独立数学脚本逐公式、逐源系数核对并严格检查缺值和非有限输入，业务回读仍未发生。", ""].join("\n");
experience = experience.replace("友军增强和三波禁锢排除。", "友军增强和三波禁锢排除；当前官方技能说明与官方2023重做说明共同支持重做后已移除禁锢。");
const readme = ["# 第四十四批候选", "", "本目录保存俄洛伊、孙悟空、妮蔻、悠米20个技能槽的静态候选。来源固定客户端16.17、官方16.17.1、当前中文绑定正文和主负责人逐槽核对说明；Cursor只读来源复核为READY（4618事件、62个工具、23个输入、业务写入0）。", "", "共" + counts.newParameters + "个新增参数、" + counts.newFormulas + "个新增公式、" + counts.newEffects + "个新增效果，共" + requests.length + "项新增请求意图；26个公共冷却/法力参数只复用。", "", "候选按技能最高等级完整保存，悠米Q为六级；角色等级曲线未知时使用无默认实际输入。所有运算节点严格双目，比例属性先按系统比例换算，增量效果使用attribute_flat_add。", "", "效果只使用RESOURCE_CHANGE、NORMAL_SHIELD和ATTRIBUTE_CHANGE，不创建DAMAGE、DIRECT_HEAL或MOMENT_EVALUATION。俄洛伊Q主动本体伤害、孙悟空R目标最大生命比例、悠米E自身护盾与攻移速以及同一敌人重复数值均已拆开。", "", "主负责人源值说明已在生成前纳入并在散列中记录；请求计划仅为POST意图，未执行任何业务接口或Git写入。", "", "文件入口：完整候选.json、请求计划.json、来源值摘要.json、来源与范围.json、来源哈希汇总.json、候选版本.json、独立数学核算.mjs、独立数学核算.json、体验报告.md。"].join("\n");
const artifactFiles = { "完整候选.json": candidateBytes, "请求计划.json": planBytes, "来源值摘要.json": sourceValuesBytes, "来源与范围.json": JSON.stringify(sourceScope, null, 2) + "\n", "来源哈希汇总.json": JSON.stringify(sourceHashes, null, 2) + "\n", "候选版本.json": JSON.stringify(version, null, 2) + "\n", "README.md": readme, "体验报告.md": experience };
for (const [file, content] of Object.entries(artifactFiles)) write(path.join(OUTPUT_ROOT, file), content);
fs.mkdirSync(OUTPUT_DURABLE, { recursive: true });
for (const [file, content] of Object.entries(artifactFiles)) { write(path.join(OUTPUT_DURABLE, file), content); assert(shaFile(path.join(OUTPUT_ROOT, file)) === shaFile(path.join(OUTPUT_DURABLE, file)), "持久目录字节不一致：" + file); }
console.log(JSON.stringify({ batch: BATCH, revision: REVISION, counts, requestCount: requests.length, candidateSha256, planSha256, sourceValuesSha256, protectedCounts, apiCalls: 0, apiWrites: 0 }, null, 2));
