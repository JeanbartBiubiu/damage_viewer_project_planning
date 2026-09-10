import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero50-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第五十批");
const REVIEW = path.resolve(ROOT, "..", "hero50-cursor-review-run-20260910");
const EXISTING_REVIEW = path.resolve(ROOT, "..", "hero50-existing-review");
const BATCH = "第五十批乌迪尔阿兹尔艾希伊泽瑞尔";
const REVISION = "hero50-source-v1-luna-candidate";
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const SOURCE_VERSION = {
  clientVersion: "16.17",
  officialVersion: "16.17.1",
  build: "16.17.8104348+branch.releases-16-17.content.release",
};

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const writeBytes = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const writeJson = (file, value) => writeBytes(file, jsonBytes(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const norm = value => {
  const number = Number(value);
  assert(Number.isFinite(number), `不是有限数字：${value}`);
  return Math.abs(number) < 1e-12 ? 0 : Number(number.toFixed(9));
};
const toMs = seconds => {
  const raw = Number(seconds);
  const milliseconds = raw * 1000;
  const rounded = Math.round(milliseconds);
  assert(Number.isFinite(raw) && raw >= 0 && Math.abs(milliseconds - rounded) <= 1e-3, `时间不是可精确换算的整数毫秒：${seconds}`);
  return rounded;
};

const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const versionFile = path.join(INPUT, "输入版本.json");
const rangeFile = path.join(INPUT, "主负责人最终范围与核对说明.md");
const sourceNoteFile = path.join(INPUT, "主负责人前两英雄源值核对.md");
const inputReadmeFile = path.join(INPUT, "README.md");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const protectionListFile = path.join(INPUT, "参考资料", "已有组成保护清单.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const cursorConclusionFile = path.join(REVIEW, "Cursor来源复核结论.md");
const cursorAuditFile = path.join(REVIEW, "主负责人执行审计.json");
const cursorSummaryFile = path.join(REVIEW, "summary.json");
const cursorReviewFile = path.join(REVIEW, "review.md");
const cursorPreflightFile = path.join(REVIEW, "preflight.md");

for (const file of [bindingFile, versionFile, rangeFile, sourceNoteFile, inputReadmeFile, protectionFile, reuseFile, protectionListFile, attributeFile, payloadFile, cursorConclusionFile, cursorAuditFile, cursorSummaryFile, cursorReviewFile, cursorPreflightFile]) {
  assert(fs.existsSync(file), `缺少冻结输入：${file}`);
}

const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const protectionList = readJson(protectionListFile);
const cursorAudit = readJson(cursorAuditFile);
const cursorSummary = readJson(cursorSummaryFile);
const cursorConclusion = fs.readFileSync(cursorConclusionFile, "utf8");
const protectedByRoute = new Map((protection.requests || []).map(item => [item.route, item]));
const heroes = Object.fromEntries((binding.heroes || []).map(hero => [hero.id, hero]));
const sourceSkills = Object.fromEntries((binding.heroes || []).map(hero => [hero.id, Object.fromEntries((hero.skills || []).map(skillItem => [skillItem.slot, skillItem]))]));
const skillKeyOf = (heroId, slot) => `${heroes[heroId]?.key === "ez" ? "ez" : heroId.toLowerCase()}_${slot.toLowerCase()}`;
const maxLevelFor = skillKey => {
  const hit = protectedByRoute.get(`/skills/${skillKey}`);
  assert(hit?.status === 200 && Number.isInteger(hit.data?.maxLevel), `缺少技能最高等级：${skillKey}`);
  return hit.data.maxLevel;
};
const skillAt = (heroId, slot) => {
  const item = sourceSkills[heroId]?.[slot];
  assert(item, `缺少源技能：${heroId}/${slot}`);
  return item;
};
const spell = (heroId, slot) => skillAt(heroId, slot).object.mSpell;
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot).DataValues || []).find(item => item.name === name);
  assert(row && Array.isArray(row.values), `缺少DataValue：${heroId}/${slot}/${name}`);
  return row.values;
};
const dataAt = (heroId, slot, name, index = 1) => {
  const value = dataRow(heroId, slot, name)[index];
  assert(typeof value === "number" && Number.isFinite(value), `源DataValue不是有限数字：${heroId}/${slot}/${name}/${index}`);
  return value;
};
const levelValues = (heroId, slot, name, count, start = 1, transform = value => value) => {
  const values = dataRow(heroId, slot, name);
  assert(values.length > start + count - 1, `等级数组长度不足：${heroId}/${slot}/${name}`);
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index + 1), norm(transform(values[start + index]))]));
};
const fieldAt = (heroId, slot, name, index = 1, transform = value => norm(value)) => {
  const value = spell(heroId, slot)[name];
  if (Array.isArray(value)) {
    assert(value.length > index && typeof value[index] === "number" && Number.isFinite(value[index]), `缺少源字段数组值：${heroId}/${slot}/${name}/${index}`);
    return transform(value[index]);
  }
  assert(typeof value === "number" && Number.isFinite(value), `缺少源字段数字值：${heroId}/${slot}/${name}`);
  return transform(value);
};
const calculation = (heroId, slot, name) => {
  const value = (spell(heroId, slot).mSpellCalculations || {})[name];
  assert(value, `缺少计算树：${heroId}/${slot}/${name}`);
  return value;
};
const coefficient = (heroId, slot, name, index = 1) => {
  const part = (calculation(heroId, slot, name).mFormulaParts || [])[index];
  assert(part && typeof part.mCoefficient === "number" && Number.isFinite(part.mCoefficient), `缺少树系数：${heroId}/${slot}/${name}/${index}`);
  return norm(part.mCoefficient);
};
const multiplierNumber = (heroId, slot, name) => {
  const value = calculation(heroId, slot, name).mMultiplier?.mNumber;
  assert(typeof value === "number" && Number.isFinite(value), `缺少树固定倍率：${heroId}/${slot}/${name}`);
  return norm(value);
};
const numberPart = (heroId, slot, name, index = 0) => {
  const value = calculation(heroId, slot, name).mFormulaParts?.[index]?.mNumber;
  assert(typeof value === "number" && Number.isFinite(value), `缺少树固定数字：${heroId}/${slot}/${name}/${index}`);
  return norm(value);
};
const officialFor = (heroId, slot, english = false) => {
  const file = path.join(INPUT, "参考资料", english ? "官方英文" : "官方中文", `${heroId}.json`);
  const root = readJson(file).data[heroId];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};

assert(binding.clientVersion === SOURCE_VERSION.clientVersion && binding.officialVersion === SOURCE_VERSION.officialVersion, "来源版本不符");
assert(inputVersion.GETs === 292 && inputVersion.reusedParameters === 26 && inputVersion.apiWrites === 0, "冻结输入计数或写入状态不符");
assert(protection.GETs === 292 && protection.apiWrites === 0 && protection.requests.length === 292, "保护快照计数不符");
assert(cursorAudit.readonlyAuditPassed === true && cursorAudit.resultStatus === "finished" && cursorAudit.events === 3550 && cursorAudit.uniqueTools === 63 && cursorAudit.inputsChecked === 27 && cursorAudit.apiWrites === 0, "Cursor实际复核审计不符");
assert((Array.isArray(cursorAudit.gitDelta) ? cursorAudit.gitDelta.length : Number(cursorAudit.gitDelta || 0)) === 0, "Cursor审计存在Git变化");
assert(cursorAudit.reviewedPlanRev === "hero50-source-v1" && /READY/.test(cursorConclusion), "Cursor复核没有READY结论");
const cursorGitDelta = Array.isArray(cursorAudit.gitDelta) ? cursorAudit.gitDelta.length : Number(cursorAudit.gitDelta || 0);
const reuseSet = new Set(reuseList.map(item => `${item.skillKey}/${item.parameterKey}`));
const compositionKinds = ["parameters", "formulas", "effects", "processes", "internal-states", "trigger-rules"];
const existingKeyField = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", "internal-states": "stateKey", "trigger-rules": "ruleKey" };
const existingTotals = Object.fromEntries(compositionKinds.map(kind => [kind, 0]));
for (const key of ["ashe_w", "ashe_r", "ez_p", "ez_q", "ez_w", "ez_e", "ez_r"]) for (const kind of compositionKinds) {
  const rows = protectedByRoute.get(`/skills/${key}/${kind}`)?.data;
  assert(Array.isArray(rows), `缺少已有组成保护：${key}/${kind}`);
  existingTotals[kind] += rows.length;
}
assert(JSON.stringify(existingTotals) === JSON.stringify({ parameters: 65, formulas: 8, effects: 16, processes: 4, "internal-states": 0, "trigger-rules": 13 }), `已有组成总数不符：${JSON.stringify(existingTotals)}`);

const attributeSnapshot = protectedByRoute.get("/attributes")?.data?.items || [];
const actualAttributeKeys = new Set(attributeSnapshot.map(item => item.attributeKey));
for (const key of ["attack_damage", "ability_power", "hp", "bonus_attack_speed_percent", "move_speed_percent", "attack_range", "critical_strike_chance", "critical_strike_damage_bonus_percent"]) assert(actualAttributeKeys.has(key), `属性目录缺少：${key}`);

const attribute = (owner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner: owner, attributeKey, attributeValueKind });
const sourceHP = kind => attribute("SOURCE", "hp", kind);
const targetHP = kind => attribute("TARGET", "hp", kind);
const AP = () => attribute("SOURCE", "ability_power", "TOTAL");
const totalAD = () => attribute("SOURCE", "attack_damage", "TOTAL");
const bonusAD = () => attribute("SOURCE", "attack_damage", "BONUS");
const critChance = () => attribute("SOURCE", "critical_strike_chance", "TOTAL");
const critDamageBonus = () => attribute("SOURCE", "critical_strike_damage_bonus_percent", "TOTAL");
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const SUB = (left, right) => O("SUBTRACT", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);

const fixed = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({ parameterKey, name, valueType, valueMode: "FIXED", fixedValue: norm(fixedValue), levelValues: null, description, sortOrder });
const fixedRaw = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({ parameterKey, name, valueType, valueMode: "FIXED", fixedValue, levelValues: null, description, sortOrder });
const addFixed = (add, parameterKey, name, valueType, fixedValue, description, sortOrder) => add(fixed(parameterKey, name, valueType, fixedValue, description, sortOrder));
const skillParam = (parameterKey, name, valueType, values, description, sortOrder) => ({ parameterKey, name, valueType, valueMode: "SKILL_LEVEL", fixedValue: null, levelValues: values, description, sortOrder });
const runtime = (parameterKey, name, valueType, description, sortOrder) => ({ parameterKey, name, valueType, valueMode: "RUNTIME_INPUT", fixedValue: null, levelValues: null, description, sortOrder });
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const lifecycle = (durationKey, instanceScope = "SOURCE") => ({
  durationValue: durationKey ? { kind: "PARAMETER", parameterKey: durationKey } : null,
  maxStacksValue: { kind: "FIXED", value: 1 }, applicationStacksValue: { kind: "FIXED", value: 1 }, instanceScope,
  reapplicationStackMode: "KEEP", reapplicationDurationMode: durationKey ? "REFRESH_ALL" : null,
  expiryMode: durationKey ? "ALL_AT_ONCE" : "EXPLICIT_ONLY", periodicIntervalValue: null, firstPeriodicExecution: null,
});
const persistentResultLifecycle = () => ({ moment: "PERSISTENT", valueReadMode: "APPLICATION_SNAPSHOT", stackValueMode: "SHARED", reapplicationValueMode: "REPLACE", periodicExecutionMode: null });
const valueRule = (kind, key) => ({ value: { kind, [kind === "PARAMETER" ? "parameterKey" : "formulaKey"]: key }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const resourceEffect = (effectKey, name, parameterKey, description, sortOrder = 900) => ({
  effectKey, name, description, sortOrder, lifecycle: null,
  results: [{ resultKey: "consume_mana", name, resultType: "RESOURCE_CHANGE", target: "SOURCE", description: "仅记录基础法力消耗；实际扣除时点由过程层接线。", sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule("PARAMETER", parameterKey), detail: { attributeKey: "mana", operation: "CONSUME" } }],
});
const attributeEffect = (effectKey, name, valueKind, valueKey, attributeKey, durationKey, description, sortOrder = 20, operation = "INCREASE", target = "SOURCE") => ({
  effectKey, name, description, sortOrder, lifecycle: lifecycle(durationKey, target),
  results: [{ resultKey: "attribute", name, resultType: "ATTRIBUTE_CHANGE", target, description: "只记录属性变化，触发条件由事件层接线。", sortOrder: 10, lifecycleBehavior: persistentResultLifecycle(), spellShieldBlockScope: null, valueRule: valueRule(valueKind, valueKey), detail: { attributeKey, operation, modifierZoneKey: "attribute_flat_add" } }],
});
const shieldEffect = (effectKey, name, formulaKey, durationKey, description, sortOrder = 20) => ({
  effectKey, name, description, sortOrder, lifecycle: lifecycle(durationKey),
  results: [{ resultKey: "shield", name, resultType: "NORMAL_SHIELD", target: "SOURCE", description: "普通护盾；应用与移除事件由事件层接线。", sortOrder: 10, lifecycleBehavior: persistentResultLifecycle(), spellShieldBlockScope: null, valueRule: valueRule("FORMULA", formulaKey), detail: { absorbedDamageTypeKey: null, decayMode: "NONE" } }],
});
const damageEffect = (effectKey, name, formulaKey, damageTypeKey, description, sortOrder = 20, deliveryKind = "SKILL") => ({
  effectKey, name, description, sortOrder, lifecycle: null,
  results: [{ resultKey: "damage", name, resultType: "DAMAGE", target: "TARGET", description: "单一目标伤害结果；命中事件与伤害树分开记录。", sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: "RESULT", valueRule: valueRule("FORMULA", formulaKey), detail: { damageTypeKey, deliveryKind, originKind: "DIRECT", critical: { mode: "DISALLOWED", multiplierValue: null }, vampRules: [] } }],
});
const directHealEffect = (effectKey, name, formulaKey, description, sortOrder = 20) => ({
  effectKey, name, description, sortOrder, lifecycle: null,
  results: [{ resultKey: "heal", name, resultType: "DIRECT_HEAL", target: "SOURCE", description: "只记录自身直接治疗；事件次数和时点由运行层接线。", sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule("FORMULA", formulaKey), detail: {} }],
});

const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const bound = skillAt(heroId, slot);
  const rawSpell = bound.object.mSpell;
  const sourceMeta = (hero.source.skills || []).find(item => item.slot === slot) || {};
  const clientFile = path.join(INPUT, "参考资料", "客户端原文", `${heroId}.json.gz`);
  const officialZhFile = path.join(INPUT, "参考资料", "官方中文", `${heroId}.json`);
  const officialEnFile = path.join(INPUT, "参考资料", "官方英文", `${heroId}.json`);
  assert(fs.existsSync(clientFile) && shaFile(clientFile) === hero.source.client.compressedSha256, `客户端压缩源散列不符：${heroId}`);
  assert(fs.existsSync(officialZhFile) && fs.existsSync(officialEnFile), `官方资料缺失：${heroId}`);
  const fields = ["mEffectAmount", "mCastTime", "spellCastTime", "spellTotalTime", "mChannelDuration", "cooldownTime", "Cooldown", "mana", "manaValues", "mMaxAmmo", "mAmmoRechargeTime", "mDoesNotConsumeMana", "mDoesNotConsumeCooldown", "mTargetingTypeData", "mClientData", "castRange", "castRangeDisplayOverride", "castRadius", "missileSpeed", "mMissileSpec", "mSpellTags", "mAffectsTypeFlags"];
  return {
    hero: heroId, heroName: hero.name, heroKey: hero.key, slot, resourceType: hero.source.resourceType, rootPath: hero.rootPath,
    spellPath: sourceMeta.clientPath || bound.binding, bindingAvailable: sourceMeta.bindingAvailable ?? true,
    clientFile: `参考资料/客户端原文/${heroId}.json.gz`, clientSha256: hero.source.client.sha256, clientCompressedSha256: shaFile(clientFile), clientContentSha256: hero.source.client.sha256, clientBuild: hero.source.client.contentVersion,
    officialZhFile: `参考资料/官方中文/${heroId}.json`, officialZhSha256: shaFile(officialZhFile), officialEnFile: `参考资料/官方英文/${heroId}.json`, officialEnSha256: shaFile(officialEnFile),
    currentBoundText: clone(bound.currentTexts), dynamicText: null,
    raw: { dataValues: Object.fromEntries((rawSpell.DataValues || []).map(row => [row.name, row.values ? clone(row.values) : null])), calculations: clone(rawSpell.mSpellCalculations || {}), fields: Object.fromEntries(fields.map(key => [key, rawSpell[key] === undefined ? null : clone(rawSpell[key])])) },
    officialEvidence: { zh: clone(officialFor(heroId, slot)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}/currentTexts`, dynamicTextPath: null, officialMaxRank: sourceMeta.officialMaxRank ?? null,
  };
};

const defs = {};
const define = (heroId, slot, title, build, excluded, pending, proofNote) => {
  const skillKey = skillKeyOf(heroId, slot);
  const write = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  const add = item => {
    if (!item || !item.parameterKey || reuseSet.has(`${skillKey}/${item.parameterKey}`)) return;
    assert(!write.parameters.some(existing => existing.parameterKey === item.parameterKey), `重复参数：${skillKey}/${item.parameterKey}`);
    write.parameters.push(item);
  };
  const addFormula = item => { assert(!write.formulas.some(existing => existing.formulaKey === item.formulaKey), `重复公式：${skillKey}/${item.formulaKey}`); write.formulas.push(item); };
  const addEffect = item => { assert(!write.effects.some(existing => existing.effectKey === item.effectKey), `重复效果：${skillKey}/${item.effectKey}`); write.effects.push(item); };
  const existingComposition = {};
  for (const kind of compositionKinds) {
    const route = `/skills/${skillKey}/${kind}`;
    const hit = protectedByRoute.get(route);
    const rows = hit?.data;
    assert(hit?.status === 200 && Array.isArray(rows), `缺少受保护组成列表：${route}`);
    const keyField = existingKeyField[kind];
    existingComposition[kind] = { route, status: hit.status, count: rows.length, keys: rows.map(item => item[keyField]).filter(Boolean), sha256: sha256(JSON.stringify(rows)) };
  }
  const subject = protectedByRoute.get(`/skills/${skillKey}`);
  assert(subject?.status === 200, `缺少受保护技能主体：${skillKey}`);
  build(add, addFormula, addEffect);
  defs[skillKey] = {
    skillKey, name: `${heroes[heroId].name}·${title}`, maxLevel: subject.data.maxLevel, source: sourceFor(heroId, slot), write,
    protectedExisting: { subject: true, compositionLists: true, protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json", existingComposition }, excluded, pending,
    proofs: [
      { type: "root-bound-source", path: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}` },
      { type: "fixed-source-version", client: SOURCE_VERSION.clientVersion, official: SOURCE_VERSION.officialVersion, build: SOURCE_VERSION.build },
      { type: "cursor-source-review", runId: cursorAudit.runId, verdict: "READY", reviewedPlanRev: cursorAudit.reviewedPlanRev },
      { type: "existing-composition-protection", snapshot: "输入包/参考资料/当前20槽保护快照.json", count: Object.values(existingComposition).reduce((sum, item) => sum + item.count, 0) },
    ],
    proofNote, currentSubject: clone(subject.data),
  };
};
const addSkillData = (add, heroId, slot, dataName, key, name, type, description, order, transform = value => value) => add(skillParam(key, name, type, levelValues(heroId, slot, dataName, maxLevelFor(skillKeyOf(heroId, slot)), 1, transform), description, order));
const addFixedData = (add, heroId, slot, dataName, key, name, type, description, order, transform = value => norm(value), index = 1) => add(fixedRaw(key, name, type, transform(dataAt(heroId, slot, dataName, index)), description, order));
const addField = (add, heroId, slot, fieldName, key, name, type, description, order, index = 1, transform = value => norm(value)) => add(fixedRaw(key, name, type, fieldAt(heroId, slot, fieldName, index, transform), description, order));
const addManaIfReused = (skillKey, addEffect, description) => { if (reuseSet.has(`${skillKey}/mana_cost`)) addEffect(resourceEffect("mana_cost", "施放法力消耗", "mana_cost", description)); };

define("Udyr", "P", "众灵纽带", (add, addFormula, addEffect) => {
  addFixedData(add, "Udyr", "P", "AttackSpeedDuration", "attack_speed_duration_ms", "被动攻击速度持续（毫秒）", "INTEGER", "DataValues.AttackSpeedDuration=4秒，精确换算为4000毫秒。", 10, toMs);
  addFixedData(add, "Udyr", "P", "UltCDReduction", "awakened_cooldown_return_ratio", "觉醒冷却返还比例", "DECIMAL", "DataValues.UltCDReduction=0.05；正文显示为5%，返还剩余或总冷却的结算基准未知。", 20);
  addFixedData(add, "Udyr", "P", "UltCDMultiplier", "awakened_cooldown_multiplier", "觉醒冷却基础倍率", "DECIMAL", "UltCD树使用UltCDMultiplier=1。", 30);
  addFixedData(add, "Udyr", "P", "GlobalCD", "stance_global_cooldown_ms", "普通姿态共用间隔（毫秒）", "INTEGER", "DataValues.GlobalCD=1.5秒，精确换算为1500毫秒。", 40, toMs);
  addFixedData(add, "Udyr", "P", "GlobalCDEmpowered", "awakened_global_cooldown_ms", "觉醒姿态共用间隔（毫秒）", "INTEGER", "DataValues.GlobalCDEmpowered=0.5秒，精确换算为500毫秒。", 50, toMs);
  addFixed(add, "attack_speed_ratio", "被动攻击速度比例", "DECIMAL", numberPart("Udyr", "P", "AttackSpeed"), "AttackSpeed计算树固定mNumber=0.3，按比例属性记录。", 60);
  addFixed(add, "attack_count", "被动获得攻速的攻击次数", "INTEGER", 2, "当前中文正文明确为下两次攻击；事件触发仍待接线。", 70);
  addFixed(add, "ult_cd_base_ms", "觉醒冷却起始值（毫秒）", "INTEGER", toMs(50), "UltCD计算树起始值50秒；6/11/16级断点另独立记录。", 80);
  addFixed(add, "ult_cd_breakpoint_6_ms", "6级觉醒冷却断点增量（毫秒）", "INTEGER", -10000, "UltCD断点在角色6级额外减少10秒。", 90);
  addFixed(add, "ult_cd_breakpoint_11_ms", "11级觉醒冷却断点增量（毫秒）", "INTEGER", -10000, "UltCD断点在角色11级额外减少10秒。", 100);
  addFixed(add, "ult_cd_breakpoint_16_ms", "16级觉醒冷却断点增量（毫秒）", "INTEGER", -10000, "UltCD断点在角色16级额外减少10秒。", 110);
  addEffect(attributeEffect("attack_speed_buff", "武僧修行攻击速度", "PARAMETER", "attack_speed_ratio", "bonus_attack_speed_percent", "attack_speed_duration_ms", "技能使用后的下两次攻击获得0.3额外攻击速度；攻击次数和觉醒冷却返还事件待接线。", 20));
}, ["龙类地图收益和未消费的旧被动伤害计算树排除；不新建觉醒技能套装。"], ["两次攻击、姿态转换、觉醒再次施放、返还基准及6/11/16级冷却断点应用时点待运行层接线；不将断点外等级补成斜率。"], "保留当前根被动本体：固定30%攻速、4秒、下两次攻击、5%觉醒冷却返还、50秒起始冷却和三处断点；未把返还误写成绝对冷却变化。");

define("Udyr", "Q", "狂暴爪击", (add, addFormula, addEffect) => {
  addSkillData(add, "Udyr", "Q", "AttackSpeedBase", "attack_speed_ratio", "普通姿态攻击速度比例", "DECIMAL", "AttackSpeedBase按技能等级1至6取0.20至0.80；1表示100%。", 10);
  addFixedData(add, "Udyr", "Q", "AttackSpeedDurationBase", "attack_speed_duration_ms", "普通姿态持续（毫秒）", "INTEGER", "DataValues.AttackSpeedDurationBase=4秒，精确换算为4000毫秒。", 20, toMs);
  addFixedData(add, "Udyr", "Q", "AttackSpeedDurationEmpowered", "empowered_attack_speed_duration_ms", "觉醒姿态持续（毫秒）", "INTEGER", "DataValues.AttackSpeedDurationEmpowered=4秒，精确换算为4000毫秒。", 30, toMs);
  addSkillData(add, "Udyr", "Q", "MaxHPOnHitBase", "max_hp_on_hit_ratio", "普通下两次攻击目标最大生命比例", "DECIMAL", "MaxHPOnHitBase按技能等级1至6取0.03至0.08；源树为百分比，展开伤害时乘目标最大生命。", 40);
  addSkillData(add, "Udyr", "Q", "BaseDamage", "base_damage", "普攻附加基础物理伤害", "INTEGER", "BaseDamage按技能等级1至6取6至36。", 50);
  addSkillData(add, "Udyr", "Q", "OnHitBonusHPRatio", "on_hit_bonus_hp_ratio", "普攻附伤自身额外生命比例", "DECIMAL", "OnHitDamage第三分支按技能等级1至6取0.01至0.02×来源额外生命。", 60);
  addFixedData(add, "Udyr", "Q", "MaxHPADRatio", "max_hp_ad_ratio", "普通目标最大生命额外攻击力比例", "DECIMAL", "MaxHPOnHit1第二分支mStat=2、mStatFormula=2，系数0.00035为额外攻击力比例。", 70);
  addFixedData(add, "Udyr", "Q", "Q2MaxHPADRatio", "empowered_max_hp_ad_ratio", "觉醒目标最大生命额外攻击力比例", "DECIMAL", "Q2TotalOnHitHPDamage第三分支系数0.0005为额外攻击力比例。", 80);
  addFixedData(add, "Udyr", "Q", "LightningAPRatio", "lightning_ap_ratio", "闪电法强比例", "DECIMAL", "EmpoweredLightningBonus第二分支读取LightningAPRatio=0.00006×法强。", 90);
  addFixedData(add, "Udyr", "Q", "Bounces", "lightning_bounce_count", "落单闪电打击次数", "INTEGER", "Bounces=6；只用于一次完整闪电载荷，不把下两次攻击自动扩为12击。", 100);
  addFixedData(add, "Udyr", "Q", "BounceRange", "lightning_bounce_range", "闪电弹射范围", "INTEGER", "BounceRange=450；额外目标分配本轮排除。", 110);
  addFixedData(add, "Udyr", "Q", "RepeatBouncePenalty", "repeat_bounce_penalty", "重复弹射倍率", "DECIMAL", "EmpoweredLightningBonusMax使用RepeatBouncePenalty=1。", 120);
  addFixed(add, "bounce_multiplier_base", "弹射倍率基准", "DECIMAL", 1, "EmpoweredLightningBonusMax树固定基准1。", 130);
  addFixed(add, "bounce_count_subtract_one", "弹射次数减一", "INTEGER", -1, "EmpoweredLightningBonusMax树使用Bounces−1。", 140);
  addFixedData(add, "Udyr", "Q", "LightningDamageLevel1", "lightning_level_ratio_start", "角色1级闪电生命比例端点", "DECIMAL", "EmpoweredLightningBonus的角色等级端点为0.015；中间曲线未知。", 160);
  addFixedData(add, "Udyr", "Q", "LightningDamageLevel18", "lightning_level_ratio_end", "角色18级闪电生命比例端点", "DECIMAL", "EmpoweredLightningBonus的角色等级端点为0.03；中间曲线未知。", 170);
  addFixedData(add, "Udyr", "Q", "EmpoweredBonusASLevel1", "empowered_bonus_as_start", "角色1级觉醒攻速端点", "DECIMAL", "EmpoweredTotalAS角色等级端点为0.20；中间曲线未知。", 180);
  addFixedData(add, "Udyr", "Q", "EmpoweredBonusASLevel18", "empowered_bonus_as_end", "角色18级觉醒攻速端点", "DECIMAL", "EmpoweredTotalAS角色等级端点为0.70；中间曲线未知。", 190);
  addFixed(add, "empowered_percent_hp_level_start", "角色1级觉醒百分比生命端点", "DECIMAL", 0.02, "Q2TotalOnHitHPDamage角色等级额外比例端点为0.02。", 200);
  addFixed(add, "empowered_percent_hp_level_end", "角色18级觉醒百分比生命端点", "DECIMAL", 0.04, "Q2TotalOnHitHPDamage角色等级额外比例端点为0.04。", 210);
  addFixed(add, "empowered_source_hp_ratio", "觉醒自身额外生命比例", "DECIMAL", coefficient("Udyr", "Q", "Q2TotalOnHitHPDamage", 3), "Q2TotalOnHitHPDamage第四分支mStat=12系数0.00001；展开时乘来源额外生命。", 220);
  addFixedData(add, "Udyr", "Q", "AttackRange", "attack_range_bonus", "姿态攻击距离增加", "INTEGER", "AttackRange=50；只新增一次稳定参数。", 230);
  addField(add, "Udyr", "Q", "spellCastTime", "spell_cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确换算为250毫秒。", 240, 1, toMs);
  writeRuntime(add, "lightning_level_ratio_actual", "实际角色等级闪电生命比例", "DECIMAL", "由运行层按角色等级提供LightningDamageLevel1至18之间的实际值；源曲线未知且无默认。", 250);
  writeRuntime(add, "empowered_bonus_as_actual", "实际角色等级觉醒攻速比例", "DECIMAL", "由运行层提供EmpoweredBonusASLevel1至18之间的实际值；源曲线未知且无默认。", 260);
  writeRuntime(add, "empowered_percent_hp_level_actual", "实际角色等级觉醒百分比生命比例", "DECIMAL", "由运行层提供角色等级额外0.02至0.04比例；源曲线未知且无默认。", 270);
  const onHit = ADD(ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), MUL(P("on_hit_bonus_hp_ratio"), sourceHP("BONUS")));
  addFixed(add, "bonus_ad_ratio", "普攻附伤额外攻击力倍率", "DECIMAL", 0.2, "OnHitDamage第二分支mStat=2系数0.2。", 275);
  addFormula(formula("on_hit_physical_damage", "狂暴爪击普攻附加物理伤害", onHit, "OnHitDamage=BaseDamage+0.2×来源额外攻击力+OnHitBonusHPRatio×来源额外生命。", 10));
  addFormula(formula("standard_max_health_physical_damage", "狂暴爪击普通目标最大生命伤害", MUL(ADD(P("max_hp_on_hit_ratio"), MUL(P("max_hp_ad_ratio"), bonusAD())), targetHP("TOTAL")), "MaxHPOnHit1为(普通最大生命比例+0.00035×额外攻击力)×目标最大生命；一名目标的下两次攻击资格待接线。", 20));
  addFormula(formula("empowered_max_health_physical_damage", "狂暴爪击觉醒目标最大生命伤害", MUL(ADD(ADD(ADD(P("max_hp_on_hit_ratio"), P("empowered_percent_hp_level_actual")), MUL(P("empowered_max_hp_ad_ratio"), bonusAD())), MUL(P("empowered_source_hp_ratio"), sourceHP("BONUS"))), targetHP("TOTAL")), "Q2TotalOnHitHPDamage展开为(普通比例+角色等级比例+0.0005×额外攻击力+0.00001×来源额外生命)×目标最大生命；觉醒段替代普通百分比段。", 30));
  addFormula(formula("empowered_total_attack_speed_ratio", "狂暴爪击觉醒攻击速度比例", ADD(P("attack_speed_ratio"), P("empowered_bonus_as_actual")), "EmpoweredTotalAS=AttackSpeedBase+角色等级觉醒攻速；觉醒段替代普通攻速段。", 40));
  const lightningPercent = ADD(P("lightning_level_ratio_actual"), MUL(P("lightning_ap_ratio"), AP()));
  const bounceMultiplier = ADD(P("bounce_multiplier_base"), MUL(ADD(P("lightning_bounce_count"), P("bounce_count_subtract_one")), P("repeat_bounce_penalty")));
  addFormula(formula("empowered_lightning_single_magic_damage", "狂暴爪击单次闪电魔法伤害", MUL(lightningPercent, targetHP("TOTAL")), "EmpoweredLightningBonus是目标最大生命百分比；这里按正文目标语义展开为单次比例×目标最大生命。", 50));
  addFormula(formula("lightning_bounce_multiplier", "狂暴爪击落单闪电总倍率", bounceMultiplier, "EmpoweredLightningBonusMax的倍率为1+(Bounces−1)×RepeatBouncePenalty；落单为6倍单次，不扩为两次攻击。", 60));
  addFormula(formula("empowered_lightning_total_magic_damage", "狂暴爪击落单闪电总魔法伤害", MUL(lightningPercent, MUL(targetHP("TOTAL"), bounceMultiplier)), "按正文目标最大生命语义展开：单次闪电比例×目标最大生命×落单弹射总倍率；其他目标分配排除。", 70));
  addEffect(attributeEffect("standard_attack_speed", "狂暴爪击普通攻击速度", "PARAMETER", "attack_speed_ratio", "bonus_attack_speed_percent", "attack_speed_duration_ms", "普通姿态额外攻击速度；与觉醒攻击速度效果二选一。", 20));
  addEffect(damageEffect("standard_on_hit", "狂暴爪击普攻附加物理伤害", "on_hit_physical_damage", "physics", "每次合资格普攻一次附伤；普通攻击本身不由此效果重复生成。", 30, "BASIC_ATTACK"));
  addEffect(damageEffect("standard_max_health_hit", "狂暴爪击普通百分比物理伤害", "standard_max_health_physical_damage", "physics", "下两次攻击的目标最大生命物理伤害；实际次数待接线。", 40, "BASIC_ATTACK"));
  addEffect(attributeEffect("empowered_attack_speed", "狂暴爪击觉醒攻击速度", "FORMULA", "empowered_total_attack_speed_ratio", "bonus_attack_speed_percent", "empowered_attack_speed_duration_ms", "觉醒攻速为完整替代段，不与普通攻击速度比例相加。", 50));
  addEffect(damageEffect("empowered_max_health_hit", "狂暴爪击觉醒百分比物理伤害", "empowered_max_health_physical_damage", "physics", "觉醒下两次攻击的百分比生命物理伤害替代普通百分比段；实际次数待接线。", 60, "BASIC_ATTACK"));
  addEffect(damageEffect("empowered_lightning", "狂暴爪击觉醒落单闪电", "empowered_lightning_total_magic_damage", "magic", "单一目标一次完整六击载荷；不把两次攻击自动复制为12击。", 70));
  addEffect(attributeEffect("attack_range", "狂暴爪击攻击距离", "PARAMETER", "attack_range_bonus", "attack_range", "attack_speed_duration_ms", "姿态期间增加50攻击距离；不表示施法距离。", 80));
  addManaIfReused("udyr_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["野怪封顶、兵线最低伤害、其他目标弹射与额外目标分配排除。"], ["普通/觉醒替代关系、下两次攻击如何触发闪电六击、角色等级未知曲线、普攻事件和目标最大生命读取时点待接线；不将已知端点插值成默认18级曲线。"], "保留OnHitDamage、MaxHPOnHit1、Q2TotalOnHitHPDamage、EmpoweredTotalAS、EmpoweredLightningBonus/Max五类本体数值；目标最大生命乘法是正文语义展开，不假称原树自带TARGET.hp；攻击距离只录一次。");

define("Udyr", "W", "坚铁甲胄", (add, addFormula, addEffect) => {
  addFixedData(add, "Udyr", "W", "ShieldDuration", "shield_duration_ms", "护盾与觉醒治疗窗口（毫秒）", "INTEGER", "ShieldDuration=4秒，精确换算为4000毫秒。", 10, toMs);
  addSkillData(add, "Udyr", "W", "ShieldBase", "shield_base", "普通护盾基础值", "INTEGER", "ShieldBase按技能等级1至6取45至145。", 20);
  addSkillData(add, "Udyr", "W", "ShieldPercentHealth", "shield_hp_ratio", "普通护盾自身最大生命比例", "DECIMAL", "ShieldPercentHealth按技能等级1至6取0.02至0.035，乘来源最大生命。", 30);
  addFixedData(add, "Udyr", "W", "ShieldAPRatio", "shield_ap_ratio", "普通护盾法强倍率", "DECIMAL", "TotalShield第三分支读取ShieldAPRatio=0.4。", 40);
  addFixedData(add, "Udyr", "W", "LifeOnHitHPRatio", "life_on_hit_hp_ratio", "命中治疗自身最大生命比例", "DECIMAL", "LifeOnHit第一分支读取1.2%来源最大生命。", 50);
  addFixedData(add, "Udyr", "W", "OnHitHealAPRatio", "life_on_hit_ap_ratio", "命中治疗法强倍率", "DECIMAL", "LifeOnHit第二分支读取0.08×法强。", 60);
  addSkillData(add, "Udyr", "W", "LifeSteal", "life_steal_ratio", "普通生命偷取比例", "DECIMAL", "LifeSteal按技能等级1至6取0.15至0.20；1表示100%。", 70);
  addFixedData(add, "Udyr", "W", "HealAttackMult", "awakened_heal_attack_multiplier", "觉醒攻击治疗倍率", "DECIMAL", "HealAttackMult=2；觉醒命中治疗和生命偷取各翻倍。", 80);
  addFixedData(add, "Udyr", "W", "PercentOfShieldHealAmount", "awakened_total_heal_ratio", "觉醒护盾治疗比例", "DECIMAL", "RecastHeal=PercentOfShieldHealAmount×RecastShield=0.5×觉醒护盾，持续4秒总量。", 90);
  addFixed(add, "shield_bonus_ad_ratio", "普通护盾额外攻击力倍率", "DECIMAL", coefficient("Udyr", "W", "TotalShield", 3), "TotalShield第四分支mStat=2系数0.5。", 100);
  addFixed(add, "awakened_shield_ap_ratio", "觉醒护盾法强倍率", "DECIMAL", coefficient("Udyr", "W", "RecastShield", 2), "RecastShield第三分支系数0.65×法强。", 110);
  addFixed(add, "awakened_shield_hp_ratio", "觉醒护盾自身最大生命比例", "DECIMAL", coefficient("Udyr", "W", "RecastShield", 3), "RecastShield第四分支mStat=12系数0.08×来源最大生命。", 120);
  addFixed(add, "awakened_shield_bonus_ad_ratio", "觉醒护盾额外攻击力倍率", "DECIMAL", coefficient("Udyr", "W", "RecastShield", 4), "RecastShield第五分支mStat=2、mStatFormula=2系数1×额外攻击力。", 130);
  addFixed(add, "awakened_shield_level_start", "角色1级觉醒护盾基础端点", "INTEGER", 20, "RecastShield角色等级端点起始20；中间曲线未知。", 140);
  addFixed(add, "awakened_shield_level_end", "角色18级觉醒护盾基础端点", "INTEGER", 150, "RecastShield角色等级端点结束150；中间曲线未知。", 150);
  addSkillData(add, "Udyr", "W", "ShieldBase", "awakened_shield_base_from_skill", "觉醒护盾技能基础值", "INTEGER", "觉醒护盾仍加入当前技能等级ShieldBase，不重复制造普通护盾。", 160);
  addField(add, "Udyr", "W", "spellCastTime", "spell_cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确换算为250毫秒。", 170, 1, toMs);
  writeRuntime(add, "awakened_shield_level_actual", "角色等级觉醒护盾基础值", "INTEGER", "由运行层提供RecastShield在当前角色等级的20至150实际值；中间曲线未知且无默认。", 180);
  addFixed(add, "attack_count", "命中治疗与吸血的攻击次数", "INTEGER", 2, "当前中文正文明确下两次攻击；事件次数待接线。", 190);
  addFormula(formula("normal_shield", "坚铁甲胄普通护盾", ADD(ADD(ADD(P("shield_base"), MUL(P("shield_hp_ratio"), sourceHP("TOTAL"))), MUL(P("shield_ap_ratio"), AP())), MUL(P("shield_bonus_ad_ratio"), bonusAD())), "TotalShield=ShieldBase+ShieldPercentHealth×来源最大生命+0.4×法强+0.5×额外攻击力。", 10));
  addFormula(formula("life_on_hit_heal", "坚铁甲胄普通命中治疗", ADD(MUL(P("life_on_hit_hp_ratio"), sourceHP("TOTAL")), MUL(P("life_on_hit_ap_ratio"), AP())), "LifeOnHit=1.2%×来源最大生命+0.08×法强；不套用野怪惩罚。", 20));
  const awakenedShield = ADD(ADD(ADD(ADD(P("awakened_shield_level_actual"), P("awakened_shield_base_from_skill")), MUL(P("awakened_shield_ap_ratio"), AP())), MUL(P("awakened_shield_hp_ratio"), sourceHP("TOTAL"))), MUL(P("awakened_shield_bonus_ad_ratio"), bonusAD()));
  addFormula(formula("awakened_shield", "坚铁甲胄觉醒护盾", awakenedShield, "RecastShield=角色等级实际基础值+技能基础值+0.65×法强+0.08×来源最大生命+1×额外攻击力；与剩余普通护盾叠加。", 30));
  addFormula(formula("awakened_total_heal", "坚铁甲胄觉醒持续总治疗", MUL(awakenedShield, P("awakened_total_heal_ratio")), "RecastHeal=0.5×觉醒护盾，表示4秒窗口的总量；不使用旧HealPerSecond或Omnivamp。", 40));
  addFormula(formula("awakened_on_hit_heal", "坚铁甲胄觉醒命中治疗", MUL(ADD(MUL(P("life_on_hit_hp_ratio"), sourceHP("TOTAL")), MUL(P("life_on_hit_ap_ratio"), AP())), P("awakened_heal_attack_multiplier")), "LifeOnHitAwakened=HealAttackMult×LifeOnHit。", 50));
  addFormula(formula("awakened_life_steal_ratio", "坚铁甲胄觉醒生命偷取比例", MUL(P("life_steal_ratio"), P("awakened_heal_attack_multiplier")), "觉醒生命偷取=LifeSteal×HealAttackMult；替代普通生命偷取段。", 60));
  addEffect(shieldEffect("normal_shield", "坚铁甲胄普通护盾", "normal_shield", "shield_duration_ms", "普通护盾；觉醒护盾应用时与剩余普通护盾叠加。", 20));
  addEffect(attributeEffect("normal_life_steal", "坚铁甲胄普通生命偷取", "PARAMETER", "life_steal_ratio", "life_steal_percent", "shield_duration_ms", "普通姿态下两次攻击的生命偷取比例；攻击次数待接线。", 30));
  addEffect(directHealEffect("normal_on_hit_heal", "坚铁甲胄普通命中治疗", "life_on_hit_heal", "每次合资格命中回复一次；只记录自身实际治疗公式。", 40));
  addEffect(shieldEffect("awakened_shield", "坚铁甲胄觉醒护盾", "awakened_shield", "shield_duration_ms", "觉醒护盾独立应用并与剩余普通护盾叠加；护盾值在应用时读取。", 50));
  addEffect(directHealEffect("awakened_total_heal", "坚铁甲胄觉醒4秒总治疗", "awakened_total_heal", "4秒持续治疗的总量表达；周期分配和结束事件待接线，不冒充每秒治疗。", 60));
  addEffect(attributeEffect("awakened_life_steal", "坚铁甲胄觉醒生命偷取", "FORMULA", "awakened_life_steal_ratio", "life_steal_percent", "shield_duration_ms", "觉醒生命偷取替代普通段并翻倍；不与普通比例相加。", 70, "SET"));
  addEffect(directHealEffect("awakened_on_hit_heal", "坚铁甲胄觉醒命中治疗", "awakened_on_hit_heal", "觉醒下两次攻击的单次命中治疗；实际攻击次数待接线。", 80));
  addManaIfReused("udyr_w", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["小兵命中回复惩罚、野怪分支、旧HealPerSecond和Omnivamp树排除；不新建外部友方效果。"], ["觉醒护盾角色等级中间曲线、普通/觉醒应用顺序、下两次攻击事件、4秒治疗的周期分配和吸血结算时点待接线；不把总治疗拆成每秒或补永久寿命。"], "保留TotalShield、LifeOnHit、RecastShield、RecastHeal、LifeOnHitAwakened及觉醒生命偷取树；明确普通护盾值与觉醒护盾值不重复乘2。");

define("Udyr", "E", "踏火蛮冲", (add, addFormula, addEffect) => {
  addSkillData(add, "Udyr", "E", "ICD", "target_icd_ms", "单目标攻击眩晕冷却（毫秒）", "INTEGER", "ICD按技能等级1至6取6/5.6/5.2/4.8/4.4/4秒，精确换算为整数毫秒。", 10, toMs);
  addSkillData(add, "Udyr", "E", "BaseMoveSpeed", "base_move_speed_ratio", "普通姿态移动速度比例", "DECIMAL", "BaseMoveSpeed按技能等级1至6取0.25至0.55，1表示100%。", 20);
  addFixedData(add, "Udyr", "E", "MoveSpeedDuration", "move_speed_duration_ms", "普通移动速度持续（毫秒）", "INTEGER", "MoveSpeedDuration=4秒，精确换算为4000毫秒；源正文说明持续衰减但曲线未消费。", 30, toMs);
  addFixedData(add, "Udyr", "E", "StunDuration", "stun_duration_ms", "目标眩晕持续（毫秒）", "INTEGER", "StunDuration=0.75秒，精确换算为750毫秒。", 40, toMs);
  addFixedData(add, "Udyr", "E", "EmpoweredBonusRange", "empowered_attack_range_bonus", "觉醒攻击距离增加", "INTEGER", "EmpoweredBonusRange=75；作为觉醒期间攻击距离属性增加。", 50);
  addFixedData(add, "Udyr", "E", "UnstoppableDuration", "unstoppable_duration_ms", "觉醒免疫与额外移速持续（毫秒）", "INTEGER", "UnstoppableDuration=1.5秒，精确换算为1500毫秒。", 60, toMs);
  addFixed(add, "move_speed_bonus_ad_ratio", "普通移动速度额外攻击力倍率", "DECIMAL", coefficient("Udyr", "E", "MoveSpeed", 1), "MoveSpeed第二分支mStat=2、mStatFormula=2系数0.0005。", 70);
  addFixed(add, "empowered_move_speed_ad_ratio", "觉醒移动速度额外攻击力倍率", "DECIMAL", coefficient("Udyr", "E", "MoveSpeedBonus", 1), "MoveSpeedBonus第二分支mStat=2、mStatFormula=2系数0.001。", 80);
  addFixed(add, "empowered_move_speed_start_ratio", "角色1级觉醒移动速度端点", "DECIMAL", 0.3, "MoveSpeedBonus角色等级起始端点0.30；中间曲线未知。", 90);
  addFixed(add, "empowered_move_speed_end_ratio", "角色18级觉醒移动速度端点", "DECIMAL", 0.4, "MoveSpeedBonus角色等级结束端点0.40；中间曲线未知。", 100);
  addFixed(add, "attack_count_per_target", "每目标首次攻击次数", "INTEGER", 1, "当前正文明确每个目标第一次攻击造成眩晕；每目标独立冷却。", 110);
  addField(add, "Udyr", "E", "spellCastTime", "spell_cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确换算为250毫秒。", 120, 1, toMs);
  writeRuntime(add, "empowered_move_speed_level_actual", "实际角色等级觉醒移动速度比例", "DECIMAL", "由运行层提供0.30至0.40之间的角色等级实际值；源曲线未知且无默认。", 130);
  addFormula(formula("base_move_speed_ratio", "踏火蛮冲普通移动速度", ADD(P("base_move_speed_ratio"), MUL(P("move_speed_bonus_ad_ratio"), bonusAD())), "MoveSpeed=BaseMoveSpeed+0.0005×来源额外攻击力；正文的持续衰减曲线不在本公式中猜测。", 10));
  addFormula(formula("empowered_move_speed_ratio", "踏火蛮冲觉醒额外移动速度", ADD(P("empowered_move_speed_level_actual"), MUL(P("empowered_move_speed_ad_ratio"), bonusAD())), "MoveSpeedBonus=角色等级实际端点值+0.001×来源额外攻击力；觉醒段是额外移速。", 20));
  addEffect(attributeEffect("base_move_speed", "踏火蛮冲普通移动速度", "FORMULA", "base_move_speed_ratio", "move_speed_percent", "move_speed_duration_ms", "普通姿态移动速度；源正文的持续衰减曲线待运行层接线。", 20));
  addEffect(attributeEffect("empowered_move_speed", "踏火蛮冲觉醒额外移动速度", "FORMULA", "empowered_move_speed_ratio", "move_speed_percent", "unstoppable_duration_ms", "觉醒额外移动速度；不与普通移速替代或相加规则之外的第三段混写。", 30));
  addEffect(attributeEffect("empowered_attack_range", "踏火蛮冲觉醒攻击距离", "PARAMETER", "empowered_attack_range_bonus", "attack_range", "unstoppable_duration_ms", "觉醒期间额外攻击距离；不表示施法范围。", 40));
  addManaIfReused("udyr_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["碰撞体积忽略与攻击无法取消的事件细节不展开；不新建控制免疫状态键。"], ["Stun状态键、每目标首次攻击事件、每目标ICD、冲刺位移、持续衰减函数和觉醒定身/限制免疫状态待运行层接线；不把未消费的{aedeb4cc}写成线性衰减。"], "保留ICD、眩晕、普通/觉醒移速、攻击距离、施法时间等明确值；控制状态和位移只留资格与待接线，不盲造状态字典。");

define("Udyr", "R", "极凌飓风", (add, addFormula, addEffect) => {
  addFixedData(add, "Udyr", "R", "BuffDuration", "storm_duration_ms", "风暴持续（毫秒）", "INTEGER", "BuffDuration=4秒，精确换算为4000毫秒。", 10, toMs);
  addSkillData(add, "Udyr", "R", "SlowPotency", "slow_ratio", "风暴减速比例", "DECIMAL", "SlowPotency按技能等级1至6取0.15至0.30；1表示100%。", 20);
  addFixedData(add, "Udyr", "R", "SlowDuration", "slow_duration_ms", "目标减速持续（毫秒）", "INTEGER", "SlowDuration=2秒，精确换算为2000毫秒；与4秒风暴寿命分开。", 30, toMs);
  addSkillData(add, "Udyr", "R", "StormBaseDamage", "storm_base_damage", "风暴每秒基础魔法伤害", "INTEGER", "StormBaseDamage按技能等级1至6取20至100；每秒一段数值。", 40);
  addFixedData(add, "Udyr", "R", "StormAPRatio", "storm_ap_ratio", "风暴法强倍率", "DECIMAL", "StormDamage第二分支与PercentHPBlast第二分支读取0.00035；后者按目标最大生命比例展开。", 50);
  addFixed(add, "storm_damage_ap_ratio", "风暴伤害法强倍率", "DECIMAL", coefficient("Udyr", "R", "StormDamage", 1), "StormDamage第二分支mCoefficient=0.35×法强。", 60);
  addFixed(add, "pulse_ap_ratio", "风暴脉冲法强倍率", "DECIMAL", coefficient("Udyr", "R", "PulseDamage", 1), "PulseDamage第二分支mCoefficient=0.35×法强。", 70);
  addFixed(add, "pulse_level_start", "角色1级脉冲基础端点", "INTEGER", 10, "PulseDamage角色等级起始端点10；中间曲线未知。", 80);
  addFixed(add, "pulse_level_end", "角色18级脉冲基础端点", "INTEGER", 40, "PulseDamage角色等级结束端点40；中间曲线未知。", 90);
  addFixed(add, "percent_hp_level_start_ratio", "角色1级觉醒目标生命端点", "DECIMAL", 0.08, "PercentHPBlast角色等级起始端点0.08；中间曲线未知。", 100);
  addFixed(add, "percent_hp_level_end_ratio", "角色18级觉醒目标生命端点", "DECIMAL", 0.14, "PercentHPBlast角色等级结束端点0.14；中间曲线未知。", 110);
  addFixed(add, "empowered_slow_ratio", "觉醒额外减速比例", "DECIMAL", numberPart("Udyr", "R", "EmpoweredSlow"), "EmpoweredSlow树固定0.05；状态应用待接线。", 120);
  addFixed(add, "storm_tick_interval_ms", "风暴伤害间隔（毫秒）", "INTEGER", 1000, "当前中文正文明确每秒伤害；间隔精确记录为1000毫秒，不代表完整事件已接线。", 130);
  addFixed(add, "pulse_attack_count", "风暴脉冲攻击次数", "INTEGER", 2, "当前中文正文明确下两次攻击；实际攻击触发待接线。", 140);
  addField(add, "Udyr", "R", "mCastTime", "m_cast_time_ms", "内部施法时间（毫秒）", "INTEGER", "当前根mCastTime=0.1秒，精确换算为100毫秒。", 150, 0, toMs);
  addField(add, "Udyr", "R", "spellCastTime", "spell_cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确换算为250毫秒；与mCastTime分开。", 160, 1, toMs);
  writeRuntime(add, "pulse_level_actual", "实际角色等级脉冲基础值", "DECIMAL", "由运行层提供PulseDamage在10至40端点之间的实际角色等级值；源曲线未知且无默认。", 170);
  writeRuntime(add, "percent_hp_level_actual_ratio", "实际角色等级觉醒目标生命比例", "DECIMAL", "由运行层提供PercentHPBlast在0.08至0.14端点之间的实际值；源曲线未知且无默认。", 180);
  addFormula(formula("storm_damage_per_second", "极凌飓风每秒魔法伤害", ADD(P("storm_base_damage"), MUL(P("storm_damage_ap_ratio"), AP())), "StormDamage=StormBaseDamage+0.35×法强；单次公式值由每秒事件读取。", 10));
  addFormula(formula("pulse_damage", "极凌飓风攻击脉冲魔法伤害", ADD(P("pulse_level_actual"), MUL(P("pulse_ap_ratio"), AP())), "PulseDamage=角色等级实际基础值+0.35×法强；下两次攻击的事件次数另接。", 20));
  addFormula(formula("empowered_percent_hp_damage", "极凌飓风觉醒目标最大生命魔法伤害", MUL(ADD(P("percent_hp_level_actual_ratio"), MUL(P("storm_ap_ratio"), AP())), targetHP("TOTAL")), "PercentHPBlast按正文持续期间总量展开为(角色等级实际比例+0.00035×法强)×目标最大生命；不再乘4秒。", 30));
  addEffect(damageEffect("storm_damage", "极凌飓风风暴伤害", "storm_damage_per_second", "magic", "风暴每秒对同一目标的一段魔法伤害；总持续次数与区域命中待接线。", 20));
  addEffect(damageEffect("pulse_damage", "极凌飓风攻击脉冲", "pulse_damage", "magic", "风暴中的合资格攻击脉冲；只记录每次脉冲数值。", 30, "BASIC_ATTACK"));
  addEffect(damageEffect("empowered_percent_hp_damage", "极凌飓风觉醒百分比生命伤害", "empowered_percent_hp_damage", "magic", "觉醒释放后同一追踪目标的持续期总量；不把总量误拆为每秒或再乘4。", 40));
  addManaIfReused("udyr_r", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["小兵伤害缩放、野怪最低伤害、其他目标分配和兵野专用分支排除；不新建风暴单位。"], ["风暴区域命中、每秒重复次数、同一目标追踪、脉冲两次攻击、减速状态与觉醒额外减速事件待接线；未知角色等级曲线无默认。"], "保留StormDamage、PulseDamage、PercentHPBlast三段；目标最大生命乘法为正文目标语义展开，觉醒段是持续期总量且不乘4。");

define("Azir", "P", "恕瑞玛的遗产", (add, addFormula, addEffect) => {}, ["太阳圆盘生命、攻击、抗性、瓦解、独立冷却与自主单位整链排除。"], ["本轮不创建空效果或炮台单位。"], "固定本体槽与保护快照一致，持久炮台链完全不在本轮录入。");
define("Azir", "Q", "狂沙猛攻", (add, addFormula, addEffect) => {}, ["黄沙士兵位移、士兵攻击、减速、额外目标与持续士兵链整槽排除。"], ["本轮不新增Q消耗、伤害或空效果；兵种依赖未满足。"], "Q需要本轮排除的持续士兵实体与攻击链，保护空组成。");
define("Azir", "W", "沙兵现身", (add, addFormula, addEffect) => {}, ["黄沙士兵自主存在、10秒寿命、两充能、多次戳刺和攻击特效整链排除。"], ["不创建士兵单位，不新增W伤害、资源或触发。"], "完整W是自主单位链，不作为单次可控载荷。");

define("Azir", "E", "流沙移形", (add, addFormula, addEffect) => {
  addSkillData(add, "Azir", "E", "BaseDamage", "base_damage", "突进基础魔法伤害", "INTEGER", "BaseDamage按技能等级1至5取70至230。", 10);
  addFixedData(add, "Azir", "E", "DamageRatio", "damage_ap_ratio", "突进法强倍率", "DECIMAL", "TotalDamage第二分支读取DamageRatio=0.6×法强。", 20);
  addSkillData(add, "Azir", "E", "BaseShield", "base_shield", "自身护盾基础值", "INTEGER", "BaseShield按技能等级1至5取70至230。", 30);
  addFixedData(add, "Azir", "E", "ShieldAPRatio", "shield_ap_ratio", "护盾法强倍率", "DECIMAL", "TotalShield第二分支读取ShieldAPRatio=0.6×法强。", 40);
  addFixedData(add, "Azir", "E", "DashSpeed", "dash_speed", "突进速度", "INTEGER", "DashSpeed=1700；只保存本体移动载荷。", 50);
  addFixedData(add, "Azir", "E", "ShieldDuration", "shield_duration_ms", "护盾持续（毫秒）", "INTEGER", "ShieldDuration=1.5秒，精确换算为1500毫秒。", 60, toMs);
  addFixedData(add, "Azir", "E", "CastRange", "soldier_qualification_range", "已有士兵资格范围", "INTEGER", "DataValues.CastRange=1100；本体施放需要已有合资格士兵，原始字段3000不当施法距离。", 70);
  addField(add, "Azir", "E", "castRangeDisplayOverride", "display_range", "显示范围", "INTEGER", "当前根显示范围1100，与资格范围单独记录。", 80);
  addFormula(formula("shield", "流沙移形自身护盾", ADD(P("base_shield"), MUL(P("shield_ap_ratio"), AP())), "TotalShield=BaseShield+0.6×来源总法强。", 10));
  addFormula(formula("magic_damage", "流沙移形突进魔法伤害", ADD(P("base_damage"), MUL(P("damage_ap_ratio"), AP())), "TotalDamage=BaseDamage+0.6×来源总法强；命中英雄停下条件另接。", 20));
  addEffect(shieldEffect("self_shield", "流沙移形自身护盾", "shield", "shield_duration_ms", "只记录阿兹尔自身护盾；已有合资格士兵为外部条件，不创建士兵。", 20));
  addEffect(damageEffect("dash_damage", "流沙移形突进魔法伤害", "magic_damage", "magic", "一次本体突进命中伤害；击退/停下事件与士兵条件待接线。", 30));
  addManaIfReused("azir_e", addEffect, "复用冻结公共法力参数；wrapper不消费标记不改变既有60法力参数。");
}, ["士兵创建、士兵充能返还、外部士兵攻击与其他目标分配排除；不把wrapper的mDoesNotConsumeMana/Cooldown改写成新的公共值。"], ["已有士兵目标资格、突进位移、命中英雄停下、护盾应用时点和击退/碰撞事件待接线；没有mCastTime或spellCastTime时不填0。"], "保留E本体一次护盾与突进伤害；原始castRange3000、显示/资格1100及公共冷却法力分开记录。");

define("Azir", "R", "禁军之墙", (add, addFormula, addEffect) => {
  addSkillData(add, "Azir", "R", "BaseDamage", "base_damage", "禁军之墙基础魔法伤害", "INTEGER", "BaseDamage按技能等级1至3取200/400/600。", 10);
  addFixed(add, "ap_ratio", "禁军之墙法强倍率", "DECIMAL", coefficient("Azir", "R", "TotalDamage", 1), "TotalDamage第二分支mCoefficient=0.75×法强。", 20);
  addFixedData(add, "Azir", "R", "WallDuration", "wall_duration_ms", "墙体持续（毫秒）", "INTEGER", "WallDuration=5秒，精确换算为5000毫秒；墙是地形寿命，不是伤害持续。", 30, toMs);
  addSkillData(add, "Azir", "R", "NumberOfSoldiers", "wall_construct_count", "墙体构成数量", "INTEGER", "NumberOfSoldiers按技能等级取6/7/8，只表示墙体构成数量，不能乘伤害。", 40);
  addField(add, "Azir", "R", "mCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根mCastTime=0.5秒，精确换算为500毫秒。", 50, 0, toMs);
  addField(add, "Azir", "R", "castRangeDisplayOverride", "display_range", "显示范围", "INTEGER", "当前根显示范围250；原始castRange25000不当实际施法距离。", 60);
  addFormula(formula("magic_damage", "禁军之墙一次冲锋魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "TotalDamage=BaseDamage+0.75×来源总法强；NumberOfSoldiers不参与伤害。", 10));
  addEffect(damageEffect("charge_damage", "禁军之墙一次冲锋魔法伤害", "magic_damage", "magic", "一次本体冲锋命中魔法伤害；击退与墙体构建另待运行层接线。", 20));
  addManaIfReused("azir_r", addEffect, "复用冻结公共法力参数；仅记录一次施放基础消耗。");
}, ["兵墙自主攻击单位、墙构成之外的士兵攻击、额外敌人分配和兵野分支排除；NumberOfSoldiers不乘伤害。"], ["击退距离、碰撞、墙体地形操作和命中事件待接线；不从6/7/8推导伤害倍数。"], "保留一次冲锋伤害、击退资格与5秒墙体寿命参数；mCastTime500毫秒、显示250和原始25000分开。");

define("Ashe", "P", "冰霜射击", (add, addFormula, addEffect) => {
  addFixedData(add, "Ashe", "P", "SlowDuration", "slow_duration_ms", "减速持续（毫秒）", "INTEGER", "当前中文正文消费SlowDuration=2秒，精确换算为2000毫秒。", 10, toMs);
  addFixed(add, "slow_start_ratio", "普通减速角色1级端点", "DECIMAL", 0.2, "SlowAmount角色等级起始端点20%；中间曲线未知。", 20);
  addFixed(add, "slow_end_ratio", "普通减速角色18级端点", "DECIMAL", 0.3, "SlowAmount角色等级结束端点30%；中间曲线未知。", 30);
  addFixed(add, "empowered_slow_start_ratio", "强化减速角色1级端点", "DECIMAL", 0.4, "EmpoweredSlowAmount角色等级起始端点40%；中间曲线未知。", 40);
  addFixed(add, "empowered_slow_end_ratio", "强化减速角色18级端点", "DECIMAL", 0.6, "EmpoweredSlowAmount角色等级结束端点60%；中间曲线未知。", 50);
  writeRuntime(add, "slow_ratio_actual", "实际角色等级普通减速比例", "DECIMAL", "由运行层提供SlowAmount在0.20至0.30之间的实际值；不猜角色等级曲线。", 60);
  writeRuntime(add, "empowered_slow_ratio_actual", "实际角色等级强化减速比例", "DECIMAL", "由运行层提供EmpoweredSlowAmount在0.40至0.60之间的实际值；持续期内衰减由运行层接线。", 70);
  addFixed(add, "crit_base_multiplier", "伤害加成树固定基准", "DECIMAL", numberPart("Ashe", "P", "DamageBonus"), "DamageBonus树第一项固定1。", 80);
  addFixed(add, "crit_subpart_base", "额外暴击伤害子项基准", "DECIMAL", 1, "DamageBonus树mSubpart第一项固定1。", 90);
  addFixed(add, "crit_subpart_coefficient", "额外暴击伤害子项系数", "DECIMAL", 1, "DamageBonus树mStat=9,mStatFormula=2子项系数1。", 100);
  addFormula(formula("damage_bonus_multiplier", "冰霜射击伤害加成倍率", ADD(P("crit_base_multiplier"), MUL(critChance(), ADD(P("crit_subpart_base"), MUL(P("crit_subpart_coefficient"), critDamageBonus())))), "DamageBonus=1+实际暴击几率×(1+实际额外暴击伤害属性)；mStat9/mStatFormula2的属性枚举仍由运行输入提供。", 10));
  addFormula(formula("modified_attack_damage", "冰霜射击既有攻击伤害展开", MUL(totalAD(), ADD(P("crit_base_multiplier"), MUL(critChance(), ADD(P("crit_subpart_base"), MUL(P("crit_subpart_coefficient"), critDamageBonus()))))), "匿名修改树将DamageBonus乘一次SOURCE.attack_damage(TOTAL)；这里仅作既有攻击的期望展开，不生成额外普攻效果。", 20));
}, ["完整独立普攻伤害、暴击额外伤害、强化减速状态和其他技能重复效果排除；不把DamageBonus的前导1另挂成额外附伤。"], ["普通/强化减速实际角色等级值、强化减速持续衰减、只对既有冰霜目标的资格差和既有基础攻击事件待接线；mStat8/9目录键存在不等于源枚举完整。"], "仅录明确的SlowDuration、减速端点及DamageBonus树；完整普攻乘法保留为数学展开公式，暂不创建独立伤害效果以避免与基本攻击重复。");

define("Ashe", "Q", "射手的专注", (add, addFormula, addEffect) => {
  addSkillData(add, "Ashe", "Q", "DamagePerStrike", "damage_per_strike", "强化攻击总攻击力倍率", "DECIMAL", "DamagePerStrike按技能等级1至5取1.10/1.15/1.20/1.25/1.30。", 10);
  addFixedData(add, "Ashe", "Q", "ShotsPerStrike", "shots_per_strike", "每次强化攻击小型打击数", "INTEGER", "ShotsPerStrike=5；只是内部小型打击数量，整段伤害不再乘5。", 20);
  addFixedData(add, "Ashe", "Q", "StackDuration", "stack_duration_ms", "全神贯注单层持续（毫秒）", "INTEGER", "StackDuration=4秒，精确换算为4000毫秒。", 30, toMs);
  addFixedData(add, "Ashe", "Q", "MaxStacks", "max_stacks", "全神贯注最大层数", "INTEGER", "MaxStacks=4；达到4层才可激活。", 40);
  addFixedData(add, "Ashe", "Q", "BuffDuration", "buff_duration_ms", "强化攻击持续（毫秒）", "INTEGER", "BuffDuration=6秒，精确换算为6000毫秒。", 50, toMs);
  addFixedData(add, "Ashe", "Q", "BonusAS", "bonus_attack_speed_ratio", "强化攻击速度比例", "DECIMAL", "BonusAS源值20/30/40/50/60为百分数点，转换为0.20/0.30/0.40/0.50/0.60。", 60, value => norm(value / 100));
  addFixedData(add, "Ashe", "Q", "TimerDuration", "timer_duration_ms", "层数计时字段（毫秒）", "INTEGER", "TimerDuration=1秒，精确换算为1000毫秒；当前无消费者，不直接写成衰减过程。", 70, toMs);
  addFixedData(add, "Ashe", "Q", "StackFalloffDuration", "stack_falloff_duration_ms", "层数衰减字段（毫秒）", "INTEGER", "StackFalloffDuration=1秒，精确换算为1000毫秒；当前无消费者，不直接写成衰减过程。", 80, toMs);
  addField(add, "Ashe", "Q", "spellCastTime", "spell_cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确换算为250毫秒。", 90, 1, toMs);
  addFormula(formula("empowered_attack_damage", "射手的专注强化攻击物理伤害", MUL(P("damage_per_strike"), totalAD()), "EmpoweredDamage=DamagePerStrike×来源总攻击力；这是一次强化攻击整段伤害，ShotsPerStrike=5不再乘入。", 10));
  addEffect(damageEffect("empowered_attack", "射手的专注强化攻击", "empowered_attack_damage", "physics", "强化期间一次普攻整段物理伤害；替代普通攻击伤害段且每次只施加一次攻击特效。", 20, "BASIC_ATTACK"));
  addEffect(attributeEffect("attack_speed_buff", "射手的专注额外攻击速度", "PARAMETER", "bonus_attack_speed_ratio", "bonus_attack_speed_percent", "buff_duration_ms", "激活后额外攻击速度；强化攻击持续6秒。", 30));
  addManaIfReused("ashe_q", addEffect, "复用冻结公共法力参数；不因0冷却另造资源。");
}, ["层数自动衰减过程、TimerDuration/StackFalloffDuration未消费过程、额外小型打击效果、额外普攻和其他目标分配排除。"], ["攻击叠层事件、4层激活资格、消耗层数、强化状态替代普通攻击、每次一次攻击特效和层数衰减时序待接线；不把0.2至0.6当作百分数点直接存储。"], "保留DamagePerStrike、ShotsPerStrike、4层/4秒、6秒强化、攻速比例换算和一次整段强化伤害；明确不乘5。");

define("Ashe", "W", "万箭齐发", (add, addFormula, addEffect) => {}, ["已有直伤、箭数、消耗和触发组成全量保护；官方effectBurn旧数组冲突不在本轮覆盖。"], ["不新增第三方、额外箭伤害或冰霜射击重复伤害；已有组成保留待统一迭代。"], "已有Ashe W组成严格保护，当前快照源值差异写入已有组成核对而不复制。");
define("Ashe", "E", "鹰击长空", (add, addFormula, addEffect) => {}, ["纯地图视野与侦查、鹰单位、5秒视野、两充能和充能时间整槽排除。"], ["不新增充能、法力、施法时间或视野效果。"], "纯视野技能按范围整槽跳过，空组成保持受保护。");
define("Ashe", "R", "魔法水晶箭", (add, addFormula, addEffect) => {}, ["已有直伤、最短/最长眩晕和消耗全量保护；沿途视野、附近敌人和距离换算排除。"], ["不新增飞行距离曲线、附近目标减速或AoE重复伤害。"], "已有Ashe R组成全量保护，未知距离转换不在本轮猜测。");

for (const slot of ["P", "Q", "W", "E", "R"]) define("Ezreal", slot, ({ P: "咒能高涨", Q: "秘术射击", W: "精华跃动", E: "奥术跃迁", R: "精准弹幕" })[slot], (add, addFormula, addEffect) => {}, ["本轮只保护已有伊泽瑞尔组成，不新增重复参数、公式、效果、过程或触发。"], ["伊泽瑞尔实际角色标识为ez，五技能稳定键为ez_p至ez_r；已有组成的几何冲突、模式和多目标边界留待统一迭代。"], "实库当前技能主体与已有组成逐详情保护；不从来源名生成champion_ezreal或ezreal技能键。");

const order = ["udyr_p", "udyr_q", "udyr_w", "udyr_e", "udyr_r", "azir_p", "azir_q", "azir_w", "azir_e", "azir_r", "ashe_p", "ashe_q", "ashe_w", "ashe_e", "ashe_r", "ez_p", "ez_q", "ez_w", "ez_e", "ez_r"];
assert(order.length === 20 && order.every(key => defs[key]), "20槽候选顺序不完整");

const frozenDamageTypeKeys = new Set((protectedByRoute.get("/damage-types")?.data?.items || []).map(item => item.damageTypeKey));
const frozenModifierZoneKeys = new Set((protectedByRoute.get("/modifier-zones")?.data?.items || []).map(item => item.modifierZoneKey));
const frozenResultTypes = new Set(["DAMAGE", "DIRECT_HEAL", "NORMAL_SHIELD", "ATTRIBUTE_CHANGE", "RESOURCE_CHANGE", "COOLDOWN_CHANGE", "STATUS_OPERATION", "LIFECYCLE_OPERATION", "DAMAGE_MODIFIER", "HEALING_MODIFIER", "DAMAGE_IMMUNITY", "HEALTH_FLOOR", "SPELL_SHIELD", "EXECUTE", "HIT_LINK_APPLICATION", "ATTACK_LINK_APPLICATION", "SKILL_HASTE_MODIFIER"]);
const frozenTargets = new Set(["SOURCE", "TARGET"]);
const frozenDeliveryKinds = new Set(["SKILL", "BASIC_ATTACK"]);
const frozenOriginKinds = new Set(["DIRECT", "REFLECTED"]);
const frozenCriticalModes = new Set(["DISALLOWED", "SOURCE_CRIT_CHANCE", "FORCED"]);
for (const key of order) for (const effect of defs[key].write.effects) for (const result of effect.results || []) {
  assert(frozenResultTypes.has(result.resultType) && frozenTargets.has(result.target), `效果类型或目标未在固定枚举中：${key}/${effect.effectKey}/${result.resultKey}`);
  const detail = result.detail || {};
  if (result.resultType === "DAMAGE") assert(frozenDamageTypeKeys.has(detail.damageTypeKey) && frozenDeliveryKinds.has(detail.deliveryKind) && frozenOriginKinds.has(detail.originKind) && frozenCriticalModes.has(detail.critical?.mode), `伤害结果枚举未在冻结字典中：${key}/${effect.effectKey}/${result.resultKey}`);
  if (result.resultType === "NORMAL_SHIELD") assert(detail.absorbedDamageTypeKey === null || frozenDamageTypeKeys.has(detail.absorbedDamageTypeKey), `护盾吸收伤害类型未在冻结字典中：${key}/${effect.effectKey}/${result.resultKey}`);
  if (Object.prototype.hasOwnProperty.call(detail, "modifierZoneKey")) assert(detail.modifierZoneKey === null || frozenModifierZoneKeys.has(detail.modifierZoneKey), `效果乘区未在冻结字典中：${key}/${effect.effectKey}/${result.resultKey}`);
  if (Object.prototype.hasOwnProperty.call(detail, "statusKey")) assert(typeof detail.statusKey === "string" && detail.statusKey.length > 0, `状态键为空：${key}/${effect.effectKey}/${result.resultKey}`);
}
assert(frozenDamageTypeKeys.has("physics") && frozenDamageTypeKeys.has("magic") && frozenDamageTypeKeys.has("real"), "冻结伤害字典不完整");
assert(frozenModifierZoneKeys.has("attribute_flat_add"), "冻结乘区字典不完整");

const reusedPublicParameters = reuseList.map(item => {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const hit = protectedByRoute.get(route);
  assert(hit?.status === 200 && hit.data, `公共参数保护缺失：${route}`);
  return { skillKey: item.skillKey, parameterKey: item.parameterKey, source: "输入包/参考资料/公共参数复用清单.json", post: false, detailRoute: route, expected: clone(hit.data), expectedSha256: sha256(JSON.stringify(hit.data)) };
});

const sourceFiles = [];
for (const item of inputVersion.sourceFiles || []) {
  const file = path.join(INPUT, item.path.replaceAll("/", path.sep));
  assert(fs.existsSync(file), `输入源文件不存在：${item.path}`);
  const actual = shaFile(file);
  assert(actual === item.sha256, `输入源文件散列不一致：${item.path}`);
  sourceFiles.push({ path: `hero50-root-entry-20260910/${item.path}`, role: item.role, sha256: actual, byteSize: fs.statSync(file).size });
}
for (const [relative, file, role] of [
  ["来源绑定与当前文本.json", bindingFile, "当前绑定与原始对象索引"], ["输入版本.json", versionFile, "输入版本"], ["主负责人最终范围与核对说明.md", rangeFile, "主负责人最终范围与核对"], ["主负责人前两英雄源值核对.md", sourceNoteFile, "前两英雄源值核对"], ["README.md", inputReadmeFile, "输入说明"], ["参考资料/已有组成保护清单.json", protectionListFile, "已有组成保护清单"],
]) sourceFiles.push({ path: `hero50-root-entry-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });
for (const [relative, file, role] of [
  ["Cursor来源复核结论.md", cursorConclusionFile, "Cursor来源复核结论"], ["主负责人执行审计.json", cursorAuditFile, "Cursor执行审计"], ["summary.json", cursorSummaryFile, "Cursor运行汇总"], ["review.md", cursorReviewFile, "Cursor评审摘要"], ["preflight.md", cursorPreflightFile, "Cursor前置检查"],
]) sourceFiles.push({ path: `hero50-cursor-review-run-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });
for (const name of ["核对脚本.mjs", "核对结果.json", "核对说明.md", "文件散列.json"]) {
  const file = path.join(EXISTING_REVIEW, name);
  if (fs.existsSync(file)) sourceFiles.push({ path: `hero50-existing-review/${name}`, role: "已有组成独立核对证据", sha256: shaFile(file), byteSize: fs.statSync(file).size });
}

const hashes = {
  sourceBindingSha256: shaFile(bindingFile), sourceRangeSha256: shaFile(rangeFile), sourceAuditSha256: shaFile(sourceNoteFile), protectionSnapshotSha256: shaFile(protectionFile), publicReuseSha256: shaFile(reuseFile), protectionListSha256: shaFile(protectionListFile), inputVersionSha256: shaFile(versionFile), attributeNarrowSha256: shaFile(attributeFile), payloadSampleSha256: shaFile(payloadFile),
  cursorConclusionSha256: shaFile(cursorConclusionFile), cursorAuditSha256: shaFile(cursorAuditFile), cursorSummarySha256: shaFile(cursorSummaryFile), cursorReviewSha256: shaFile(cursorReviewFile), cursorPreflightSha256: shaFile(cursorPreflightFile), existingReviewSha256: fs.existsSync(path.join(EXISTING_REVIEW, "核对结果.json")) ? shaFile(path.join(EXISTING_REVIEW, "核对结果.json")) : null,
};
const protectedRouteHashes = (protection.requests || []).map(item => ({ route: item.route, status: item.status, dataSha256: sha256(JSON.stringify(item.data)) }));
const protectedCompositionCount = (protection.requests || []).filter(item => /\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(item.route)).length;
assert(protectedCompositionCount === 120, `受保护组成列表数量不符：${protectedCompositionCount}`);
const generatedAt = new Date().toISOString();
const cursorReview = { conclusionFile: ".agents/artifacts/hero50-cursor-review-run-20260910/Cursor来源复核结论.md", conclusionSha256: hashes.cursorConclusionSha256, auditFile: ".agents/artifacts/hero50-cursor-review-run-20260910/主负责人执行审计.json", auditSha256: hashes.cursorAuditSha256, summaryFile: ".agents/artifacts/hero50-cursor-review-run-20260910/summary.json", summarySha256: hashes.cursorSummarySha256, verdict: "READY", runId: cursorAudit.runId, requestId: cursorAudit.requestId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, toolNames: clone(cursorAudit.toolNames || {}), inputsChecked: cursorAudit.inputsChecked, apiWrites: cursorAudit.apiWrites, gitDelta: cursorGitDelta, reviewedPlanRev: cursorAudit.reviewedPlanRev, note: "Cursor仅作来源评审；本候选未调用业务接口。" };
const candidate = {
  meta: { generatedAt, batch: BATCH, revision: REVISION, status: "候选已生成，来源与结构已冻结；未调用业务接口", gameId: "lol", apiBase: API_BASE, sourceVersion: SOURCE_VERSION,
    sourcePolicy: "固定客户端16.17、官方16.17.1、当前根绑定正文和原始计算树；明确值入候选，未知等级曲线、资格、时序和实际属性使用无默认运行输入或待接线说明。",
    scope: "乌迪尔、阿兹尔、艾希、伊泽瑞尔20个技能槽；保留乌迪尔姿态本体、阿兹尔E/R本体载荷、艾希P/Q缺失组成；阿兹尔P/Q/W完整士兵链、艾希E纯视野及艾希W/R和伊泽瑞尔五槽已有组成均排除新增。",
    ...hashes, inputGETs: inputVersion.GETs, currentGETs: inputVersion.GETs, reusedPublicParameterCount: inputVersion.reusedParameters, apiCalls: 0, apiWrites: 0, businessWrites: 0, noBusinessWrites: true, tokenStored: false, candidateSha256: null, sourceReview: cursorReview, inputPackage: ".agents/artifacts/hero50-root-entry-20260910" },
  skills: Object.fromEntries(order.map(key => [key, defs[key]])), order, reusedPublicParameters, reusedExistingParameters: [],
  counts: { newParameters: 0, newFormulas: 0, newEffects: 0, newProcesses: 0, newInternalStates: 0, newTriggerRules: 0, newTotal: 0, reusedPublicParameters: reusedPublicParameters.length, protectedExistingParameters: existingTotals.parameters, protectedExistingFormulas: existingTotals.formulas, protectedExistingEffects: existingTotals.effects, protectedExistingProcesses: existingTotals.processes, protectedExistingTriggerRules: existingTotals["trigger-rules"], plannedTotalIncludingReused: 0, protectedCurrentCompositionLists: protectedCompositionCount },
  apiWrites: 0, sourceFiles,
  sourceNotes: { fixedClient: "输入包/参考资料/客户端原文/*.json.gz，客户端16.17完整对象", fixedOfficial: "输入包/参考资料/官方中文与官方英文，官方16.17.1", currentText: "输入包/来源绑定与当前文本.json的当前根绑定正文", attributes: "输入包/参考资料/属性默认与边界.json只用于窄映射，未知运行属性无默认", payload: "输入包/参考资料/接口载荷样例.json只作结构参考，不复制数值", protectedExisting: "输入包/参考资料/当前20槽保护快照.json与已有组成独立核对" },
  protectedObjects: { snapshot: "输入包/参考资料/当前20槽保护快照.json", snapshotSha256: hashes.protectionSnapshotSha256, inputGETs: protection.GETs, requestCount: protection.requests.length, routes: protectedRouteHashes, publicReuse: clone(reusedPublicParameters), existingCompositionTotals: clone(existingTotals), note: "292条只读GET保护20个技能主体、组成列表、字典、角色和关系；26项公共参数只读复用；已有65/8/16/4/13组成不重放。" }, revision: REVISION,
};
for (const key of order) for (const [kind, countKey] of Object.entries({ parameters: "newParameters", formulas: "newFormulas", effects: "newEffects", processes: "newProcesses", internalStates: "newInternalStates", triggerRules: "newTriggerRules" })) candidate.counts[countKey] += defs[key].write[kind].length;
candidate.counts.newTotal = Object.entries(candidate.counts).filter(([key]) => key.startsWith("new") && key !== "newTotal").reduce((sum, [, value]) => sum + value, 0);
candidate.counts.plannedTotalIncludingReused = candidate.counts.newTotal + candidate.counts.reusedPublicParameters;

const scope = { generatedAt, batch: BATCH, revision: REVISION, status: "来源值与录入范围清单；未调用业务接口", inputGETs: inputVersion.GETs, reusedPublicParameters: reusedPublicParameters.length, sourceBindingSha256: hashes.sourceBindingSha256, sourceRangeSha256: hashes.sourceRangeSha256, sourceAuditSha256: hashes.sourceAuditSha256, cursorConclusionSha256: hashes.cursorConclusionSha256, cursorAuditSha256: hashes.cursorAuditSha256, cursorSummarySha256: hashes.cursorSummarySha256, sourceReviewVerdict: "READY", fixedVersions: SOURCE_VERSION,
  globalScope: { included: ["当前根本体伤害、护盾、属性与控制数值", "乌迪尔四姿态及觉醒本体", "阿兹尔E自身护盾/一次突进伤害", "阿兹尔R一次冲锋伤害与墙体寿命", "艾希P/Q缺失数值和公式", "唯一敌方英雄数学场景"], excluded: ["完整变形或替换技能套装", "独立召唤物、士兵、炮台和自主攻击链", "纯地图视野", "额外敌人、兵野与建筑分支", "未证等级插值、控制状态键和位移事件", "已有Ashe W/R与Ez五槽组成重复写入"], unknownPolicy: "未知曲线、资格、实际命中次数、属性枚举和事件时序用无默认运行输入或待接线说明；不补0、不补永久、不把端点变成默认整曲线。" },
  skills: Object.fromEntries(order.map(key => [key, { maxLevel: defs[key].maxLevel, recordableParameters: defs[key].write.parameters.map(item => item.parameterKey), recordableFormulas: defs[key].write.formulas.map(item => item.formulaKey), recordableEffects: defs[key].write.effects.map(item => item.effectKey), protectedExisting: defs[key].protectedExisting.existingComposition, excluded: clone(defs[key].excluded), pending: clone(defs[key].pending), currentSubjectProtected: true }])), noApiCalls: true, apiWrites: 0,
};

const requests = [];
for (const key of order) for (const [kind, idField, apiName] of [["parameters", "parameterKey", "parameters"], ["formulas", "formulaKey", "formulas"], ["effects", "effectKey", "effects"], ["processes", "processKey", "processes"], ["internalStates", "stateKey", "internal-states"], ["triggerRules", "ruleKey", "trigger-rules"]]) for (const body of defs[key].write[kind]) requests.push({ sequence: requests.length + 1, operation: "POST", method: "POST", route: `/skills/${key}/${apiName}`, detailRoute: `/skills/${key}/${apiName}/${body[idField]}`, skillKey: key, kind, stableKey: body[idField], status: "仅意图，未调用", body: clone(body) });
assert(requests.length === candidate.counts.newTotal, "POST计划数量与候选数量不符");
const candidateBytes = jsonBytes(candidate); const candidateSha256 = sha256(candidateBytes); candidate.meta.candidateSha256 = candidateSha256;
const scopeBytes = jsonBytes(scope); const scopeSha256 = sha256(scopeBytes);
const plan = { generatedAt, status: "仅写入意图，未调用业务接口", batch: BATCH, revision: REVISION, apiBase: API_BASE, sourceVersion: SOURCE_VERSION, candidateSha256, sourceBindingSha256: hashes.sourceBindingSha256, sourceRangeSha256: scopeSha256, inputSourceRangeSha256: hashes.sourceRangeSha256, sourceAuditSha256: hashes.sourceAuditSha256, cursorConclusionSha256: hashes.cursorConclusionSha256, cursorAuditSha256: hashes.cursorAuditSha256, cursorSummarySha256: hashes.cursorSummarySha256, protectionSnapshotSha256: hashes.protectionSnapshotSha256, publicReuseSha256: hashes.publicReuseSha256, requestCount: requests.length, counts: clone(candidate.counts), reusedPublicParameters: clone(reusedPublicParameters), protectedRoutes: protectedRouteHashes, protectedSummary: { inputGETs: protection.GETs, inputRequestCount: protection.requests.length, currentCompositionLists: protectedCompositionCount, existingCompositionTotals: clone(existingTotals), note: "写入前保护结果仅作计划；本文件不调用接口且不覆盖已有组成。" }, requests, noApiCalls: true, apiWrites: 0, businessWrites: 0 };
const planBytes = jsonBytes(plan); const planSha256 = sha256(planBytes);
const sourceValues = { generatedAt, batch: BATCH, revision: REVISION, status: "独立源值清单；未调用业务接口", sourceBindingSha256: hashes.sourceBindingSha256, sourceRangeSha256: hashes.sourceRangeSha256, sourceAuditSha256: hashes.sourceAuditSha256, cursorConclusionSha256: hashes.cursorConclusionSha256, cursorAuditSha256: hashes.cursorAuditSha256, cursorSummarySha256: hashes.cursorSummarySha256, sourceFiles: clone(sourceFiles), sourceValues: Object.fromEntries(order.map(key => { const value = defs[key].source; return [key, { hero: value.hero, heroName: value.heroName, heroKey: value.heroKey, slot: value.slot, rootPath: value.rootPath, spellPath: value.spellPath, currentText: clone(value.currentBoundText), officialZh: clone(value.officialEvidence.zh), officialEn: clone(value.officialEvidence.en), rawDataValues: clone(value.raw.dataValues), rawCalculations: clone(value.raw.calculations), rawFields: clone(value.raw.fields), selectedParameterKeys: defs[key].write.parameters.map(item => item.parameterKey), selectedFormulaKeys: defs[key].write.formulas.map(item => item.formulaKey), selectedEffectKeys: defs[key].write.effects.map(item => item.effectKey), protectedExisting: clone(defs[key].protectedExisting.existingComposition), excluded: clone(defs[key].excluded), pending: clone(defs[key].pending) }]; })), noApiCalls: true, apiWrites: 0 };
const sourceValuesBytes = jsonBytes(sourceValues); const sourceValuesSha256 = sha256(sourceValuesBytes);
const version = { generatedAt, batch: BATCH, revision: REVISION, status: "候选冻结，待独立数学核算；未调用业务接口", candidateSha256, planSha256, scopeSha256, sourceValuesSha256, ...hashes, counts: clone(candidate.counts), requestCount: requests.length, sourceMath: "独立数学核算.mjs", sourceMathStatus: "脚本已生成，待执行", cursorVerdict: "READY", cursorRunId: cursorAudit.runId, cursorEvents: cursorAudit.events, cursorUniqueTools: cursorAudit.uniqueTools, cursorInputsChecked: cursorAudit.inputsChecked, apiCalls: 0, apiWrites: 0, businessWrites: 0, noBusinessWrites: true };
const freezeNotice = { generatedAt, batch: BATCH, revision: REVISION, candidateSha256, planSha256, scopeSha256, sourceValuesSha256, ...hashes, counts: clone(candidate.counts), requestCount: requests.length, inputGETs: inputVersion.GETs, reusedPublicParameters: reusedPublicParameters.length, cursorVerdict: "READY", cursorRunId: cursorAudit.runId, cursorEvents: cursorAudit.events, cursorUniqueTools: cursorAudit.uniqueTools, cursorInputsChecked: cursorAudit.inputsChecked, apiCalls: 0, apiWrites: 0, businessWrites: 0, status: "候选已冻结，等待独立数学核算；未调用业务接口" };
const generatorBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const outputs = { "完整候选.json": candidateBytes, "请求计划.json": planBytes, "来源与范围.json": scopeBytes, "来源值摘要.json": sourceValuesBytes, "候选版本.json": jsonBytes(version), "来源冻结通知.json": jsonBytes(freezeNotice), "生成候选.mjs": generatorBytes };
const readme = [
  "# 第五十批候选", "", "本目录保存乌迪尔、阿兹尔、艾希、伊泽瑞尔20个技能槽的候选组成。来源固定客户端16.17、官方16.17.1、当前根绑定正文和原始计算树；Cursor来源复核为READY。", "", "候选只生成写入意图，未调用业务接口。292条只读保护和26项公共参数复用均在来源与计划中保留；已有艾希W/R和伊泽瑞尔五槽65个参数、8个公式、16个效果、4个过程、13个触发全部保护，不重复生成。", "", "本轮保留乌迪尔四姿态及觉醒本体、阿兹尔E自身护盾/突进伤害、阿兹尔R一次冲锋伤害/墙体寿命、艾希P/Q缺失组成；阿兹尔P/Q/W士兵链、艾希E纯视野、额外敌人/兵野/建筑分支排除。", "", "乌迪尔Q的觉醒攻速和百分比生命伤害是替代段，闪电按单一目标六击载荷记录；乌迪尔W觉醒护盾与剩余普通护盾叠加，4秒治疗保留总量；乌迪尔R觉醒目标最大生命伤害是持续期总量，不再乘4。", "", "阿兹尔E的士兵资格是外部条件，wrapper的标记不消费字段不改变公共60法力和冷却；阿兹尔R的NumberOfSoldiers只记录墙构成数量，不能乘伤害。", "", "艾希P的DamageBonus含前导1和一次总攻击力展开，不单独生成额外普攻；艾希Q强化伤害是一次整段总攻击力倍率，ShotsPerStrike=5不再乘入，攻速20至60百分数点已转换为0.2至0.6比例。", "", "公式全部使用PARAMETER、ATTRIBUTE、OPERATION三类节点且操作严格双目；固定值有限，时间统一为整数毫秒，未知曲线和事件使用无默认运行输入。独立数学脚本逐公式两场景、缺值拒绝、完整等级、属性基准、效果倍率和比例属性乘区。", "", "这些文件是静态候选与来源证据，不表示真实数据库、运行时、页面或战斗已完成。", "",
].join("\n");
Object.assign(outputs, { "README.md": Buffer.from(readme, "utf8") });
const hashesSummary = { generatedAt, batch: BATCH, revision: REVISION, status: "候选输出文件散列；未调用业务接口", sourceFiles: clone(sourceFiles), outputFiles: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, { sha256: sha256(bytes), byteSize: bytes.length }])), sourceHashes: hashes, cursorReview, noApiCalls: true, apiWrites: 0 };
outputs["来源哈希汇总.json"] = jsonBytes(hashesSummary);
for (const [name, bytes] of Object.entries(outputs)) { writeBytes(path.join(ROOT, name), bytes); writeBytes(path.join(DURABLE, name), bytes); }
const manifest = { generatedAt, batch: BATCH, revision: REVISION, files: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, { sha256: sha256(bytes), byteSize: bytes.length }])), sourceHashes: hashes, cursorReview, noApiCalls: true, apiWrites: 0 };
writeJson(path.join(ROOT, "文件散列.json"), manifest); writeJson(path.join(DURABLE, "文件散列.json"), manifest);
console.log(JSON.stringify({ candidateSha256, planSha256, scopeSha256, sourceValuesSha256, counts: candidate.counts, requestCount: requests.length, protectedCompositionCount, cursor: { verdict: "READY", runId: cursorAudit.runId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, inputsChecked: cursorAudit.inputsChecked }, root: ROOT, durable: DURABLE, apiCalls: 0, apiWrites: 0 }, null, 2));

function writeRuntime(add, parameterKey, name, valueType, description, sortOrder) {
  add(runtime(parameterKey, name, valueType, description, sortOrder));
}
