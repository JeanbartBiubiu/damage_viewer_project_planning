import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero48-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十八批");
const REVIEW = path.resolve(ROOT, "..", "hero48-cursor-review-run-20260910");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "第四十八批艾翁约里克凯隐佛耶戈";
const REVISION = "hero48-source-v1-luna-candidate";
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
const writeBytes = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
};
const writeJson = (file, value) => writeBytes(file, jsonBytes(value));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
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
const rangeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const sourceNoteFile = path.join(INPUT, "主负责人源值核对说明.md");
const inputReadmeFile = path.join(INPUT, "README.md");
const dynamicFile = path.join(INPUT, "凯隐动态正文补充.json");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const cursorConclusionFile = path.join(REVIEW, "Cursor来源复核结论.md");
const cursorAuditFile = path.join(REVIEW, "主负责人执行审计.json");
const cursorSummaryFile = path.join(REVIEW, "summary.json");
for (const file of [
  bindingFile, versionFile, rangeFile, sourceNoteFile, inputReadmeFile, dynamicFile,
  protectionFile, reuseFile, attributeFile, payloadFile, cursorConclusionFile, cursorAuditFile, cursorSummaryFile,
]) assert(fs.existsSync(file), `缺少冻结输入：${file}`);

const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const dynamic = readJson(dynamicFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const cursorAudit = readJson(cursorAuditFile);
const cursorSummary = readJson(cursorSummaryFile);
const cursorConclusion = fs.readFileSync(cursorConclusionFile, "utf8");
const dynamicByKey = Object.fromEntries((dynamic.entries || []).map(item => [item.key, item.text]));
const dynamicKeyBySlot = { P: "game_spell_kayn_p_main_0", Q: "game_spell_kayn_q_main_0", W: "game_spell_kayn_w_maintext_0", E: "game_spell_kayn_e_main_0", R: "spell_kayn_r_main_0" };
assert(binding.clientVersion === SOURCE_VERSION.clientVersion, "客户端版本不符");
assert(binding.officialVersion === SOURCE_VERSION.officialVersion, "官方版本不符");
assert(inputVersion.GETs === 193 && inputVersion.reusedParameters === 21, "第四十八批输入计数不符");
assert(inputVersion.apiWrites === 0, "冻结输入已有业务写入");
assert(dynamic.sourceSha256 === (inputVersion.sourceFiles || []).find(item => item.path.endsWith("lol-16.17-zh_CN.stringtable.json.gz"))?.sha256, "凯隐动态正文来源散列不符");
assert(shaFile(dynamicFile) === "1950eb1d4b7903862cfb66fb16d290e40cb35ba8a6da9a9150726f446a7a6142", "凯隐动态正文补充散列不符");
assert(cursorAudit.readonlyAuditPassed === true && cursorAudit.inputsChecked === 26 && cursorAudit.apiWrites === 0, "Cursor审计输入或写入计数不符");
const cursorGitDelta = Array.isArray(cursorAudit.gitDelta) ? cursorAudit.gitDelta.length : Number(cursorAudit.gitDelta || 0);
assert(cursorGitDelta === 0, "Cursor审计存在Git变化");
assert(cursorAudit.resultStatus === "finished" && cursorAudit.reviewedPlanRev === "hero48-source-v1", "Cursor审计未完成指定评审");
assert(cursorSummary.resultStatus === "finished" && /READY/.test(cursorSummary.assistantText || ""), "Cursor汇总没有完成标记");
assert(/READY|通过|完成/.test(cursorConclusion), "Cursor来源复核结论没有完成标记");

const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [
  hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill])),
]));
const snapshotByRoute = new Map((protection.requests || []).map(item => [item.route, item]));
const protectedRouteHashes = (protection.requests || []).map(item => ({
  route: item.route,
  status: item.status,
  dataSha256: sha256(JSON.stringify(item.data)),
}));
const reuseSet = new Set(reuseList.map(item => `${item.skillKey}/${item.parameterKey}`));
const skillKeyOf = (heroId, slot) => `${heroId.toLowerCase()}_${slot.toLowerCase()}`;
const maxLevelFor = (heroId, slot) => {
  const subject = snapshotByRoute.get(`/skills/${skillKeyOf(heroId, slot)}`);
  assert(subject?.status === 200 && Number.isInteger(subject.data.maxLevel), `缺少技能最高等级：${heroId}/${slot}`);
  return subject.data.maxLevel;
};
const skillAt = (heroId, slot) => {
  const value = sourceSkills[heroId]?.[slot];
  assert(value, `缺少源技能：${heroId}/${slot}`);
  return value;
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
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    String(index + 1), norm(transform(values[start + index])),
  ]));
};
const field = (heroId, slot, name) => spell(heroId, slot)[name];
const fixedField = (heroId, slot, name, index = 1, transform = value => norm(value)) => {
  const values = field(heroId, slot, name);
  if (Array.isArray(values)) {
    assert(values.length > index, `缺少源字段数组：${heroId}/${slot}/${name}`);
    return transform(values[index]);
  }
  assert(typeof values === "number", `缺少源字段数字：${heroId}/${slot}/${name}`);
  return transform(values);
};
const calculation = (heroId, slot, calculationName) => {
  const value = (spell(heroId, slot).mSpellCalculations || {})[calculationName];
  assert(value, `缺少计算树：${heroId}/${slot}/${calculationName}`);
  return value;
};
const coefficient = (heroId, slot, calculationName, index = 1) => {
  const part = (calculation(heroId, slot, calculationName).mFormulaParts || [])[index];
  assert(part && typeof part.mCoefficient === "number", `缺少树系数：${heroId}/${slot}/${calculationName}/${index}`);
  return norm(part.mCoefficient);
};
const mNumber = (heroId, slot, calculationName) => {
  const value = calculation(heroId, slot, calculationName).mMultiplier?.mNumber;
  assert(typeof value === "number", `缺少树固定倍率：${heroId}/${slot}/${calculationName}`);
  return norm(value);
};
const officialFor = (heroId, slot, english = false) => {
  const file = path.join(INPUT, "参考资料", english ? "官方英文" : "官方中文", `${heroId}.json`);
  const root = readJson(file).data[heroId];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};

const targetHP = kind => ({ nodeType: "ATTRIBUTE", attributeOwner: "TARGET", attributeKey: "hp", attributeValueKind: kind });
const sourceHP = kind => ({ nodeType: "ATTRIBUTE", attributeOwner: "SOURCE", attributeKey: "hp", attributeValueKind: kind });
const sourceHPBonus = () => sourceHP("BONUS");
const AP = () => ({ nodeType: "ATTRIBUTE", attributeOwner: "SOURCE", attributeKey: "ability_power", attributeValueKind: "TOTAL" });
const totalAD = () => ({ nodeType: "ATTRIBUTE", attributeOwner: "SOURCE", attributeKey: "attack_damage", attributeValueKind: "TOTAL" });
const bonusAD = () => ({ nodeType: "ATTRIBUTE", attributeOwner: "SOURCE", attributeKey: "attack_damage", attributeValueKind: "BONUS" });
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);

const fixed = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "FIXED", fixedValue: norm(fixedValue), levelValues: null, description, sortOrder,
});
const fixedRaw = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "FIXED", fixedValue, levelValues: null, description, sortOrder,
});
const skill = (parameterKey, name, valueType, values, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "SKILL_LEVEL", fixedValue: null, levelValues: values, description, sortOrder,
});
const runtime = (parameterKey, name, valueType, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "RUNTIME_INPUT", fixedValue: null, levelValues: null, description, sortOrder,
});
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const lifecycle = (durationKey, instanceScope = "SOURCE") => ({
  durationValue: durationKey ? { kind: "PARAMETER", parameterKey: durationKey } : null,
  maxStacksValue: { kind: "FIXED", value: 1 }, applicationStacksValue: { kind: "FIXED", value: 1 }, instanceScope,
  reapplicationStackMode: "KEEP", reapplicationDurationMode: durationKey ? "REFRESH_ALL" : null,
  expiryMode: durationKey ? "ALL_AT_ONCE" : "EXPLICIT_ONLY", periodicIntervalValue: null, firstPeriodicExecution: null,
});
const persistentResultLifecycle = () => ({
  moment: "PERSISTENT", valueReadMode: "APPLICATION_SNAPSHOT", stackValueMode: "SHARED", reapplicationValueMode: "REPLACE", periodicExecutionMode: null,
});
const valueRule = (kind, key) => ({ value: { kind, [kind === "PARAMETER" ? "parameterKey" : "formulaKey"]: key }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const resourceEffect = (effectKey, name, parameterKey, operation, description, sortOrder = 900) => ({
  effectKey, name, description, sortOrder, lifecycle: null,
  results: [{ resultKey: "resource", name, resultType: "RESOURCE_CHANGE", target: "SOURCE", description: "不表示战斗事件已经接线。", sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule("PARAMETER", parameterKey), detail: { attributeKey: "mana", operation } }],
});
const attributeEffect = (effectKey, name, valueKind, valueKey, attributeKey, durationKey, description, sortOrder = 20, operation = "INCREASE", target = "SOURCE") => ({
  effectKey, name, description, sortOrder, lifecycle: lifecycle(durationKey, target),
  results: [{ resultKey: "attribute", name, resultType: "ATTRIBUTE_CHANGE", target, description: "只定义属性变化，触发条件由事件层接线。", sortOrder: 10, lifecycleBehavior: persistentResultLifecycle(), spellShieldBlockScope: null, valueRule: valueRule(valueKind, valueKey), detail: { attributeKey, operation, modifierZoneKey: "attribute_flat_add" } }],
});
const shieldEffect = (effectKey, name, formulaKey, durationKey, description, sortOrder = 20) => ({
  effectKey, name, description, sortOrder, lifecycle: lifecycle(durationKey),
  results: [{ resultKey: "shield", name, resultType: "NORMAL_SHIELD", target: "SOURCE", description: "普通护盾，触发和移除事件由事件层接线。", sortOrder: 10, lifecycleBehavior: persistentResultLifecycle(), spellShieldBlockScope: null, valueRule: valueRule("FORMULA", formulaKey), detail: { absorbedDamageTypeKey: null, decayMode: "NONE" } }],
});
const damageEffect = (effectKey, name, formulaKey, damageTypeKey, description, sortOrder = 20) => ({
  effectKey, name, description, sortOrder, lifecycle: null,
  results: [{ resultKey: "damage", name, resultType: "DAMAGE", target: "TARGET", description: "一次技能伤害结果；事件接线与伤害树分开记录。", sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: "RESULT", valueRule: valueRule("FORMULA", formulaKey), detail: { damageTypeKey, deliveryKind: "SKILL", originKind: "DIRECT", critical: { mode: "DISALLOWED", multiplierValue: null }, vampRules: [] } }],
});
const directHealEffect = (effectKey, name, formulaKey, description, sortOrder = 20) => ({
  effectKey, name, description, sortOrder, lifecycle: null,
  results: [{ resultKey: "heal", name, resultType: "DIRECT_HEAL", target: "SOURCE", description: "只记录自身直接治疗，目标与触发事件由事件层接线。", sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: valueRule("FORMULA", formulaKey), detail: {} }],
});

const dynamicTextFor = (heroId, slot) => {
  if (heroId !== "Kayn") return null;
  const key = dynamicKeyBySlot[slot];
  assert(key && typeof dynamicByKey[key] === "string" && dynamicByKey[key].length > 0, `缺少凯隐动态正文：${key}`);
  return { sourceKey: key, text: dynamicByKey[key], sourceFile: "输入包/凯隐动态正文补充.json" };
};
const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const bindingSkill = skillAt(heroId, slot);
  const rawSpell = bindingSkill.object.mSpell;
  const sourceMeta = (hero.source.skills || []).find(item => item.slot === slot) || {};
  const clientFile = path.join(INPUT, "参考资料", "客户端原文", `${heroId}.json.gz`);
  const officialZhFile = path.join(INPUT, "参考资料", "官方中文", `${heroId}.json`);
  const officialEnFile = path.join(INPUT, "参考资料", "官方英文", `${heroId}.json`);
  return {
    hero: heroId, heroName: hero.name, heroKey: hero.key, slot, resourceType: hero.source.resourceType, rootPath: hero.rootPath,
    spellPath: sourceMeta.clientPath || bindingSkill.binding, bindingAvailable: sourceMeta.bindingAvailable ?? true,
    clientFile: `参考资料/客户端原文/${heroId}.json.gz`, clientSha256: hero.source.client.sha256,
    clientCompressedSha256: shaFile(clientFile), clientContentSha256: hero.source.client.sha256, clientBuild: hero.source.client.contentVersion,
    officialZhFile: `参考资料/官方中文/${heroId}.json`, officialZhSha256: shaFile(officialZhFile), officialEnFile: `参考资料/官方英文/${heroId}.json`, officialEnSha256: shaFile(officialEnFile),
    currentBoundText: clone(bindingSkill.currentTexts), dynamicText: dynamicTextFor(heroId, slot),
    raw: {
      dataValues: Object.fromEntries((rawSpell.DataValues || []).map(row => [row.name, row.values ? clone(row.values) : null])),
      calculations: clone(rawSpell.mSpellCalculations || {}),
      fields: Object.fromEntries(["mEffectAmount", "mCastTime", "spellCastTime", "spellTotalTime", "mChannelDuration", "cooldownTime", "Cooldown", "mana", "manaValues", "mMaxAmmo", "mAmmoRechargeTime", "mDoesNotConsumeMana", "mDoesNotConsumeCooldown", "mTargetingTypeData", "mClientData", "castRange", "castRangeDisplayOverride", "castRadius", "missileSpeed", "mMissileSpec", "mSpellTags", "mAffectsTypeFlags"].map(key => [key, rawSpell[key] ?? null])),
    },
    officialEvidence: { zh: clone(officialFor(heroId, slot)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}/currentTexts`, dynamicTextPath: heroId === "Kayn" ? "输入包/凯隐动态正文补充.json -> entries" : null,
    officialMaxRank: sourceMeta.officialMaxRank ?? null,
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
  const subject = snapshotByRoute.get(`/skills/${skillKey}`);
  assert(subject?.status === 200, `缺少受保护技能主体：${skillKey}`);
  build(add, addFormula, addEffect);
  defs[skillKey] = {
    skillKey, name: `${heroes[heroId].name}·${title}`, maxLevel: subject.data.maxLevel, source: sourceFor(heroId, slot), write,
    protectedExisting: { subject: true, compositionLists: true, protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json" }, excluded, pending,
    proofs: [{ type: "root-bound-source", path: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}` }, { type: "fixed-source-version", client: SOURCE_VERSION.clientVersion, official: SOURCE_VERSION.officialVersion, build: SOURCE_VERSION.build }, { type: "cursor-source-review", runId: cursorAudit.runId, verdict: "READY", reviewedPlanRev: cursorAudit.reviewedPlanRev || null }],
    proofNote, currentSubject: clone(subject.data),
  };
};
const addManaIfReused = (skillKey, addEffect, description) => { if (reuseSet.has(`${skillKey}/mana_cost`)) addEffect(resourceEffect("mana_cost", "施放法力消耗", "mana_cost", "CONSUME", description)); };
const addSkill = (add, heroId, slot, dataName, key, name, type, description, order, transform = value => value) => add(skill(key, name, type, levelValues(heroId, slot, dataName, maxLevelFor(heroId, slot), 1, transform), description, order));
const addFixedData = (add, heroId, slot, dataName, key, name, type, description, order, transform = value => norm(value), index = 1) => add(fixedRaw(key, name, type, transform(dataAt(heroId, slot, dataName, index)), description, order));
const addCoefficient = (add, heroId, slot, calcName, key, name, description, order, index = 1) => add(fixedRaw(key, name, "DECIMAL", coefficient(heroId, slot, calcName, index), description, order));
const addFixed = (add, key, name, type, value, description, order) => add(fixedRaw(key, name, type, value, description, order));
const addField = (add, heroId, slot, fieldName, key, name, type, description, order, index = 1, transform = value => norm(value)) => add(fixedRaw(key, name, type, transform(fixedField(heroId, slot, fieldName, index, value => value)), description, order));

define("Ivern", "P", "森林之友", (add, addFormula, addEffect) => {}, ["非史诗野怪放生、营地经济、生命/法力消耗和经验金币均按范围排除。"], ["不创建野怪、营地或独立单位接线。"], "当前根P是非史诗野怪交互；本轮只保留当前根技能主体，不新增参数或效果。");

define("Ivern", "Q", "根深敌固", (add, addFormula, addEffect) => {
  addSkill(add, "Ivern", "Q", "BaseDamage", "base_damage", "根深敌固基础魔法伤害", "INTEGER", "当前根BaseDamage按保护最高等级从索引1开始映射；索引0为占位。", 10);
  addSkill(add, "Ivern", "Q", "RootDuration", "root_duration_ms", "禁锢持续时间（毫秒）", "INTEGER", "RootDuration源值为秒，逐等级精确转换为整数毫秒。", 20, toMs);
  addFixedData(add, "Ivern", "Q", "APRatio", "ap_ratio", "法强倍率", "DECIMAL", "TotalDamage第二分支读取APRatio和来源总法强。", 30);
  addFixedData(add, "Ivern", "Q", "DashSpeed", "dash_speed", "再次施放冲刺速度", "INTEGER", "再次施放冲向同一被禁锢敌人，DashSpeed固定1500。", 40);
  addField(add, "Ivern", "Q", "mCastTime", "m_cast_time_ms", "mCastTime（毫秒）", "INTEGER", "当前根mCastTime=0.25秒，精确转换为250毫秒。", 50, 1, toMs);
  addField(add, "Ivern", "Q", "spellCastTime", "spell_cast_time_ms", "spellCastTime（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确转换为250毫秒。", 60, 1, toMs);
  addField(add, "Ivern", "Q", "castRange", "cast_range", "实际施法距离", "INTEGER", "当前根castRange索引1为1150；不与显示距离混用。", 70);
  addField(add, "Ivern", "Q", "castRangeDisplayOverride", "display_range", "显示距离", "INTEGER", "当前根显示距离1125，单独保留。", 80);
  addField(add, "Ivern", "Q", "castRadius", "cast_radius", "技能半径", "INTEGER", "当前根castRadius=210。", 90);
  addField(add, "Ivern", "Q", "missileSpeed", "missile_speed", "弹道速度", "INTEGER", "当前根missileSpeed=1300。", 100);
  addFormula(formula("magic_damage", "根深敌固魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "TotalDamage=BaseDamage+APRatio×来源总法强。", 10));
  addFormula(formula("root_duration", "根深敌固禁锢持续", P("root_duration_ms"), "RootDuration直接读取当前技能等级数组。", 20));
  addEffect(damageEffect("damage", "根深敌固魔法伤害", "magic_damage", "magic", "唯一敌人本体伤害；禁锢与再次施放冲刺的同一目标条件由事件层接线。", 20));
  addManaIfReused("ivern_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["友军突进、非史诗野怪冷却减半和其他目标分支排除。"], ["命中第一个敌人、禁锢、再次施放冲向同一目标的时序待运行层接线。"], "当前文本消费TotalDamage和RootDuration；mCastTime、spellCastTime、实际距离、显示距离、半径和弹速分开记录。");

define("Ivern", "W", "揠苗助攻", (add, addFormula, addEffect) => {
  addSkill(add, "Ivern", "W", "BaseDamage", "base_damage", "草丛附加魔法伤害基础值", "DECIMAL", "TotalDamage的BaseDamage按保护最高等级取索引1至最高等级；友军BaseDamage不录。", 10);
  addFixedData(add, "Ivern", "W", "BuffDuration", "buff_duration_ms", "离开草丛后持续时间（毫秒）", "INTEGER", "BuffDuration=3秒，精确转换为3000毫秒；不是草丛45秒寿命。", 20, toMs);
  addFixedData(add, "Ivern", "W", "RevealDuration", "reveal_duration_ms", "草丛显形持续时间（毫秒）", "INTEGER", "RevealDuration=8秒，精确转换为8000毫秒。", 30, toMs);
  addFixedData(add, "Ivern", "W", "MaxBrushDuration", "max_brush_duration_ms", "草丛最长寿命（毫秒）", "INTEGER", "MaxBrushDuration=45秒，作为地形状态上限保留。", 40, toMs);
  addFixedData(add, "Ivern", "W", "BrushRadius", "brush_radius", "草丛半径", "INTEGER", "BrushRadius固定190。", 50);
  addFixedData(add, "Ivern", "W", "BrushSpacing", "brush_spacing", "草丛间距", "INTEGER", "BrushSpacing固定90。", 60);
  addField(add, "Ivern", "W", "mMaxAmmo", "max_ammo", "最大充能数", "INTEGER", "mMaxAmmo固定3，独立于充能时间。", 70);
  addField(add, "Ivern", "W", "mAmmoRechargeTime", "ammo_recharge_ms", "充能时间（毫秒）", "INTEGER", "mAmmoRechargeTime=20秒，精确转换为20000毫秒。", 80, 1, toMs);
  addField(add, "Ivern", "W", "cooldownTime", "cooldown_interval_ms", "充能间隔字段（毫秒）", "INTEGER", "当前根cooldownTime=0.5秒，作为间隔字段保留，不当普通冷却复用。", 90, 1, toMs);
  addField(add, "Ivern", "W", "spellCastTime", "spell_cast_time_ms", "spellCastTime（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确转换为250毫秒；不得以未知mCastTime替代。", 100, 1, toMs);
  addField(add, "Ivern", "W", "castRange", "cast_range", "草丛施放距离", "INTEGER", "当前根castRange索引1为1000。", 110);
  addField(add, "Ivern", "W", "castRangeDisplayOverride", "display_range", "显示距离", "INTEGER", "当前根显示距离1150。", 120);
  addField(add, "Ivern", "W", "missileSpeed", "missile_speed", "施放弹道速度", "INTEGER", "当前根missileSpeed=1600。", 130);
  addCoefficient(add, "Ivern", "W", "TotalDamage", "ap_ratio", "法强倍率", "TotalDamage第二分支mCoefficient=0.2，读取来源总法强。", 140);
  addFormula(formula("magic_damage", "揠苗助攻附加魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "TotalDamage=BaseDamage+0.2×来源总法强；本体自身攻击附伤。", 10));
  addEffect(damageEffect("passive_damage", "揠苗助攻自身攻击附伤", "magic_damage", "magic", "只记录艾翁自身在草丛或离开草丛后的本体附伤；友军附伤和地形事件待接线。", 20));
  addManaIfReused("ivern_w", addEffect, "复用冻结公共法力参数；仅记录主动基础消耗。");
}, ["友军10–30+0.1法强附伤、1.5秒友军效果、视野本体和独立地形单位均排除。"], ["草丛创建、显形失去、离开草丛后的3秒窗口、3充能和充能时序待运行层接线。"], "当前文本消费自身TotalDamage、BuffDuration、RevealDuration与MaxBrushDuration；45秒地形寿命和3秒自身附伤窗口分开。");

define("Ivern", "E", "种豆得瓜", (add, addFormula, addEffect) => {
  addSkill(add, "Ivern", "E", "BaseShield", "base_shield", "基础护盾", "INTEGER", "BaseShield按保护最高等级取索引1至最高等级。", 10);
  addFixedData(add, "Ivern", "E", "ShieldAPRatio", "shield_ap_ratio", "护盾法强倍率", "DECIMAL", "TotalShield第二分支读取ShieldAPRatio=0.5。", 20);
  addSkill(add, "Ivern", "E", "BaseDamage", "base_damage", "爆裂基础魔法伤害", "INTEGER", "BaseDamage按保护最高等级取索引1至最高等级。", 30);
  addFixedData(add, "Ivern", "E", "DamageAPRatio", "damage_ap_ratio", "爆裂法强倍率", "DECIMAL", "TotalDamage第二分支读取DamageAPRatio=0.8。", 40);
  addSkill(add, "Ivern", "E", "SlowAmount", "slow_ratio", "爆裂减速比例", "DECIMAL", "SlowAmount已是0.40至0.60比例，正文再乘100仅用于显示。", 50);
  addFixedData(add, "Ivern", "E", "SlowDuration", "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "SlowDuration=2秒，精确转换为2000毫秒。", 60, toMs);
  addFixedData(add, "Ivern", "E", "ShieldDuration", "shield_duration_ms", "护盾持续时间（毫秒）", "INTEGER", "ShieldDuration=2秒，精确转换为2000毫秒。", 70, toMs);
  addField(add, "Ivern", "E", "castRange", "cast_range", "施法距离", "INTEGER", "当前根castRange索引1为750。", 80);
  addField(add, "Ivern", "E", "missileSpeed", "missile_speed", "施放弹道速度", "INTEGER", "当前根missileSpeed=20；按原字段保留。", 90);
  addFormula(formula("shield", "种豆得瓜护盾", ADD(P("base_shield"), MUL(P("shield_ap_ratio"), AP())), "TotalShield=BaseShield+0.5×来源总法强。", 10));
  addFormula(formula("magic_damage", "种豆得瓜爆裂魔法伤害", ADD(P("base_damage"), MUL(P("damage_ap_ratio"), AP())), "TotalDamage=BaseDamage+0.8×来源总法强。", 20));
  addEffect(shieldEffect("shield", "种豆得瓜首次护盾", "shield", "shield_duration_ms", "本轮仅保留艾翁自身目标；官方正文未直接写自身，资格来自输入补证，触发和目标接线仍待核。", 20));
  addEffect(damageEffect("explosion_damage", "种豆得瓜爆裂魔法伤害", "magic_damage", "magic", "唯一敌人爆裂伤害；减速、二次护盾条件和爆裂时点由事件层接线。", 30));
  addEffect(shieldEffect("refresh_shield", "种豆得瓜未命中时二次护盾", "shield", "shield_duration_ms", "仅当原护盾仍存且爆裂未命中敌方英雄时给自身刷新护盾；不扩展友军或小菊目标。", 40));
}, ["友方第三者、小菊、友军分配和模式覆盖分支排除。"], ["自身目标资格仅来自输入包资格补证摘要，官方正文未直接证明；原盾仍存、爆裂未命中敌方英雄、减速和二次护盾事件待运行层接线。"], "护盾、爆裂和二次护盾均按当前消费树保留；二次护盾是条件效果，不提前宣称事件接线完成。");

define("Ivern", "R", "小菊！", (add, addFormula, addEffect) => {}, ["小菊独立生命、攻击、冲击波、击飞与指挥链全部按召唤单位范围排除。"], ["不把小菊的移速、减伤、抗性或伤害映射给艾翁自身。"], "当前R仅作为独立召唤物排除证据，不新增消耗或空效果。");

define("Yorick", "P", "牧魂人", (add, addFormula, addEffect) => {}, ["坟墓、雾行者生成、属性、攻击和野怪/小兵分支均按独立召唤物范围排除。"], ["不创建雾行者生命、伤害或数量的本体效果。"], "当前P是坟墓与雾行者整链；本轮保留技能主体但不造零值效果。");

define("Yorick", "Q", "临终仪式", (add, addFormula, addEffect) => {
  addSkill(add, "Yorick", "Q", "BaseDamage", "base_damage", "额外物理伤害基础值", "INTEGER", "BonusDamage读取BaseDamage，按保护最高等级取索引1至最高等级。", 10);
  addSkill(add, "Yorick", "Q", "MissingHealthRatio", "missing_health_percent_points", "自身已损生命治疗百分数点", "INTEGER", "MissingHealthRatio为6至10百分数点，正文表示自身已损生命。", 20);
  addFixedData(add, "Yorick", "Q", "BonusDamageAD", "total_ad_ratio", "总攻击力倍率", "DECIMAL", "BonusDamage第二分支mStat=2且省略mStatFormula，按总攻击力读取0.5。", 30);
  addFixedData(add, "Yorick", "Q", "BuffDuration", "buff_duration_ms", "强化攻击窗口（毫秒）", "INTEGER", "BuffDuration=5秒，精确转换为5000毫秒。", 40, toMs);
  addFixed(add, "percent_point_ratio", "百分数点转比例", "DECIMAL", 0.01, "治疗正文的百分数点先乘0.01；该参数由正文单位语义固定，不把6当0.06直接混用。", 50);
  add(runtime("q_heal_base_actual", "QHeal实际基础治疗输入", "INTEGER", "QHeal含角色等级初始值、初始斜率和7/13级断点；断点当级计入未证，运行层必须提供实际值，不生成18级曲线或默认值。", 60));
  addFormula(formula("bonus_damage", "临终仪式额外物理伤害", ADD(P("base_damage"), MUL(P("total_ad_ratio"), totalAD())), "BonusDamage=BaseDamage+0.5×来源总攻击力，不包含那次基础普攻。", 10));
  addFormula(formula("self_heal", "临终仪式自身治疗", ADD(P("q_heal_base_actual"), MUL(MUL(P("missing_health_percent_points"), P("percent_point_ratio")), sourceHP("MISSING"))), "治疗=运行层提供的实际QHeal+MissingHealthRatio×0.01×自身已损生命；未知断点不猜。", 20));
  addEffect(damageEffect("bonus_damage", "临终仪式额外物理伤害", "bonus_damage", "physical", "只记录Q额外物理段；基础普攻本体由运行层另行处理。", 20));
  addEffect(directHealEffect("self_heal", "临终仪式自身治疗", "self_heal", "本轮仅记录自身治疗；非英雄减半、墓地唤醒和雾行者分支排除，QHeal实际值必须由运行层输入。", 30));
  addManaIfReused("yorick_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["非英雄治疗倍率、墓地/雾行者生成和基础普攻伤害本体排除。"], ["QHeal角色等级断点当级语义、基础普攻与额外段的攻击事件待运行层接线；未知实际QHeal不以0或线性曲线代替。"], "保留BonusDamage和自身治疗；MissingHealthRatio使用自身已损生命，QHeal保持真实输入。");

define("Yorick", "W", "暗灵缠身", (add, addFormula, addEffect) => {}, ["可阻挡、独立生命、碰撞和4秒寿命的灵墙属于独立单位链，本轮完全排除。"], ["不创建灵墙生命、延迟或碰撞效果，不添加空伤害。"], "独立生命墙符合本轮召唤/独立单位边界，保留为范围外证据。");

define("Yorick", "E", "哀伤之雾", (add, addFormula, addEffect) => {
  addSkill(add, "Yorick", "E", "HealthDamage", "health_damage_percent_points", "目标最大生命伤害百分数点", "DECIMAL", "HealthDamage按保护最高等级取索引1至最高等级；Calc_HealthDamage另乘0.01。", 10);
  addFixedData(add, "Yorick", "E", "HealthAPRatio", "health_ap_ratio", "最大生命法强倍率", "DECIMAL", "Calc_HealthDamage第二分支HealthAPRatio=0.03。", 20);
  addFixed(add, "percent_point_ratio", "百分数点转比例", "DECIMAL", mNumber("Yorick", "E", "Calc_HealthDamage"), "Calc_HealthDamage树mMultiplier=0.01；目标取最大生命。", 30);
  addSkill(add, "Yorick", "E", "SlowAmount", "slow_ratio", "减速比例", "DECIMAL", "SlowAmount已是0.3比例，正文按百分比显示。", 40);
  addFixedData(add, "Yorick", "E", "SlowDuration", "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "SlowDuration=1.5秒，精确转换为1500毫秒。", 50, toMs);
  addFixedData(add, "Yorick", "E", "MarkDuration", "mark_duration_ms", "标记持续时间（毫秒）", "INTEGER", "MarkDuration=4秒，精确转换为4000毫秒。", 60, toMs);
  addFixedData(add, "Yorick", "E", "MarkRange", "mark_range", "标记范围", "INTEGER", "MarkRange=1500，与实际施法距离700分开。", 70);
  addSkill(add, "Yorick", "E", "ArmorShred", "armor_shred_ratio", "护甲削减比例", "DECIMAL", "ArmorShred已是0.13至0.25比例，目标属性枚举与减益接线保持运行层处理。", 80);
  addSkill(add, "Yorick", "E", "HasteAmount", "move_speed_ratio", "自身朝标记目标移动速度比例", "DECIMAL", "HasteAmount已是0.18至0.30比例；比例属性按attribute_flat_add。", 90);
  addField(add, "Yorick", "E", "castRange", "cast_range", "实际施法距离", "INTEGER", "当前根castRange=700；不与MarkRange混用。", 100);
  addField(add, "Yorick", "E", "spellCastTime", "spell_cast_time_ms", "spellCastTime（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确转换为250毫秒。", 110, 1, toMs);
  addFormula(formula("max_health_magic_damage", "哀伤之雾目标最大生命魔法伤害", MUL(MUL(P("percent_point_ratio"), ADD(P("health_damage_percent_points"), MUL(P("health_ap_ratio"), AP()))), targetHP("TOTAL")), "Calc_HealthDamage=0.01×(HealthDamage+0.03×来源总法强)×目标最大生命。", 10));
  addEffect(damageEffect("max_health_damage", "哀伤之雾目标最大生命魔法伤害", "max_health_magic_damage", "magic", "唯一敌人本体伤害；减速、标记和兵野分支由运行层接线。", 20));
  addEffect(attributeEffect("self_move_speed", "哀伤之雾自身朝标记目标移动速度", "PARAMETER", "move_speed_ratio", "move_speed_percent", "mark_duration_ms", "只记录约里克自身朝被标记目标的移动速度比例；标记资格和移除由事件层接线。", 30));
  addManaIfReused("yorick_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["灵墙、雾行者、兵野最低/上限伤害排除。"], ["命中、唯一敌人、减速、护甲削减、标记及自身朝标记目标移动事件待运行层接线；不把未知属性枚举写成默认值。"], "HealthDamage明确读取目标最大生命；MarkRange与castRange分开，HasteAmount作为自身比例属性保留。");

define("Yorick", "R", "海屿悼词", (add, addFormula, addEffect) => {
  addSkill(add, "Yorick", "R", "RMarkDamagePercent", "r_mark_damage_percent_points", "室女标记目标最大生命伤害百分数点", "DECIMAL", "RMarkDamagePercent按R保护最高等级取索引1至最高等级；仅记录约里克本人打室女标记目标的附伤。", 10);
  addFixed(add, "percent_point_ratio", "百分数点转比例", "DECIMAL", 0.01, "RMarkDamagePercent正文为百分数点，目标取最大生命；不使用RMarkMaxDamage英雄上限。", 20);
  addField(add, "Yorick", "R", "castRange", "cast_range", "施法距离", "INTEGER", "当前根castRange=600；室女单位链排除。", 30);
  addFormula(formula("marked_target_magic_damage", "海屿悼词标记目标魔法附伤", MUL(MUL(P("percent_point_ratio"), P("r_mark_damage_percent_points")), targetHP("TOTAL")), "约里克对室女标记目标的本人附伤=0.01×RMarkDamagePercent×目标最大生命。", 10));
  addEffect(damageEffect("marked_target_damage", "海屿悼词标记目标魔法附伤", "marked_target_magic_damage", "magic", "保留约里克本人对室女标记目标的混合本体附伤；不建立室女或雾行者单位。", 20));
}, ["室女、雾行者自主输出和属性整链、RMarkMaxDamage非英雄上限排除。"], ["目标是否具备室女标记以及约里克本人攻击事件待运行层接线；本体附伤不可因室女链排除而删除。"], "当前R保留RMarkDamagePercent本体附伤，目标为最大生命，室女对象不建立。");

define("Kayn", "P", "暗裔魔镰", (add, addFormula, addEffect) => {}, ["变形竞争、暗裔治疗、影流附魔和形态专用被动整链排除。"], ["动态正文只作为未变形/形态分支排除证据，不把形态效果并入本轮。"], "动态P正文按输入补充的原始键保留在来源摘要，主体P不新增参数或效果。");

define("Kayn", "Q", "巨镰横扫", (add, addFormula, addEffect) => {
  addSkill(add, "Kayn", "Q", "BaseDamage", "base_damage", "一次伤害基础值", "INTEGER", "TotalDamage按Q保护最高等级取BaseDamage索引1至最高等级；当前未变形值75/105/135/165/195。", 10);
  addFixedData(add, "Kayn", "Q", "BonusADRatio", "bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", "TotalDamage的mStat=2且mStatFormula=2，读取来源额外攻击力0.85。", 20);
  addFixedData(add, "Kayn", "Q", "AoERadius", "aoe_radius", "旋转范围", "INTEGER", "AoERadius=300；不把旧25000施法距离当实际范围。", 30);
  addFixed(add, "double_hit_multiplier", "双段伤害倍率", "INTEGER", 2, "动态正文写明第二次造成等额伤害，完整双段为一次伤害×2。", 40);
  addField(add, "Kayn", "Q", "mCastTime", "cast_time_ms", "mCastTime（毫秒）", "INTEGER", "mCastTime=0.15秒，精确转换为150毫秒。", 50, 1, toMs);
  addField(add, "Kayn", "Q", "castRangeDisplayOverride", "display_range", "显示距离", "INTEGER", "当前根显示距离350；原castRange25000不录为实际距离。", 60);
  addFormula(formula("single_physical_damage", "巨镰横扫单段物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "TotalDamage=BaseDamage+0.85×来源额外攻击力。", 10));
  addFormula(formula("double_physical_damage", "巨镰横扫双段物理伤害", MUL(ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), P("double_hit_multiplier")), "冲刺段和旋转段各造成一次TotalDamage，完整双段以内联式表达。", 20));
  addEffect(damageEffect("single_damage", "巨镰横扫单段物理伤害", "single_physical_damage", "physical", "当前未变形本体第一段；对同一敌人的第二段另以独立效果保留。", 20));
  addEffect(damageEffect("double_damage", "巨镰横扫双段物理伤害", "double_physical_damage", "physical", "当前动态正文TotalDamage为tooltipOnly但被实际消费；双段等额和命中次数由事件层接线。", 30));
  addManaIfReused("kayn_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["暗裔最大生命/总攻击力分支、兵野上限与额外野怪伤害排除。"], ["两段实际命中、同一敌人重复命中和tooltipOnly展示接线待运行层核对；动态正文必须使用game_spell_kayn_q_main_0。"], "Q当前TotalDamage为tooltipOnly仍保留；双段等额伤害与单段公式均来自动态正文和当前计算树。");

define("Kayn", "W", "利刃纵贯", (add, addFormula, addEffect) => {
  addSkill(add, "Kayn", "W", "BaseDamage", "base_damage", "利刃纵贯基础物理伤害", "INTEGER", "TotalDamage按W保护最高等级取BaseDamage索引1至最高等级。", 10);
  addFixedData(add, "Kayn", "W", "SlowIntensity", "slow_ratio", "减速比例", "DECIMAL", "源值-0.9配合正文*-100显示90%；候选保留正的减速比例0.9。", 20, value => Math.abs(Number(value)));
  addFixedData(add, "Kayn", "W", "SlowDuration", "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "SlowDuration=1.5秒，精确转换为1500毫秒。", 30, toMs);
  addFixedData(add, "Kayn", "W", "BoxWidth", "box_width", "判定宽度", "INTEGER", "BoxWidth=160。", 40);
  addFixedData(add, "Kayn", "W", "AssRange", "display_range", "影流显示距离", "INTEGER", "当前根AssRange=900，形态分支展示值只作来源记录。", 50);
  addField(add, "Kayn", "W", "mCastTime", "cast_time_ms", "mCastTime（毫秒）", "INTEGER", "mCastTime=0.55秒，精确转换为550毫秒。", 60, 1, toMs);
  addField(add, "Kayn", "W", "castRange", "cast_range", "未变形施法距离", "INTEGER", "当前根castRange=700。", 70);
  addCoefficient(add, "Kayn", "W", "TotalDamage", "bonus_ad_ratio", "额外攻击力倍率", "TotalDamage第二分支mStat=2、mStatFormula=2、系数1.1。", 80, 1);
  addFormula(formula("physical_damage", "利刃纵贯物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "TotalDamage=BaseDamage+1.1×来源额外攻击力。", 10));
  addEffect(damageEffect("damage", "利刃纵贯物理伤害", "physical_damage", "physical", "当前未变形本体伤害；减速和形态击飞排除/待接线。", 20));
  addManaIfReused("kayn_w", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["影流移动施法/900距离和暗裔击飞及变形套装排除。"], ["唯一第一个敌人、90%减速衰减和命中事件待运行层接线；动态正文使用game_spell_kayn_w_maintext_0。"], "W源值-0.9与正文*-100保持单位边界，伤害只读取未变形TotalDamage。");

define("Kayn", "E", "掠影步", (add, addFormula, addEffect) => {
  addSkill(add, "Kayn", "E", "WallWalkDuration", "wall_walk_duration_ms", "地形内持续时间（毫秒）", "INTEGER", "WallWalkDuration按保护最高等级逐级取值并精确转换为整数毫秒；不固定使用满级9秒。", 10, toMs);
  addFixedData(add, "Kayn", "E", "MS", "move_speed_ratio", "自身移动速度比例", "DECIMAL", "MS源值40配合正文@Effect1Amount@%转换为0.4，按1=100%记录。", 20, value => Number(value) / 100);
  addFixedData(add, "Kayn", "E", "LingerTime", "out_of_terrain_end_ms", "地形外连续结束时间（毫秒）", "INTEGER", "地形外连续1.5秒提前结束，精确转换为1500毫秒。", 30, toMs);
  addFixedData(add, "Kayn", "E", "MaxInCombatTime", "max_in_combat_ms", "战斗中最长持续时间（毫秒）", "INTEGER", "英雄战斗最多1.5秒，不能用满级WallWalkDuration替代。", 40, toMs);
  addSkill(add, "Kayn", "E", "HealAmount", "heal_base", "首次进入地形基础治疗", "INTEGER", "HealAmount按保护最高等级取索引1至最高等级。", 50);
  addFixedData(add, "Kayn", "E", "HealBADRatio", "heal_bonus_ad_ratio", "额外攻击力治疗倍率", "DECIMAL", "TotalHealing读取0.45×来源额外攻击力。", 60);
  addFormula(formula("self_healing", "掠影步自身治疗", ADD(P("heal_base"), MUL(P("heal_bonus_ad_ratio"), bonusAD())), "TotalHealing=HealAmount+0.45×来源额外攻击力。", 10));
  addEffect(attributeEffect("move_speed", "掠影步自身移动速度", "PARAMETER", "move_speed_ratio", "move_speed_percent", "wall_walk_duration_ms", "只记录未变形自身40%移动速度，地形资格和定身结束由事件层接线。", 20));
  addEffect(directHealEffect("terrain_heal", "掠影步首次入地形治疗", "self_healing", "首次进入地形事件、英雄战斗提前结束和治疗时点由运行层接线；不创建形态治疗。", 30));
  addManaIfReused("kayn_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["影流70%移速、免疫减速、缩短冷却和变形分支排除。"], ["地形内/外、首次进入、定身、英雄战斗1.5秒上限和移除事件待运行层接线；动态正文使用game_spell_kayn_e_main_0。"], "E同时保留满级数组、战斗中上限和地形外提前结束时间，不把9秒当统一实际持续。");

define("Kayn", "R", "裂舍影", (add, addFormula, addEffect) => {
  addSkill(add, "Kayn", "R", "BaseDamage", "base_damage", "破体基础物理伤害", "INTEGER", "新动态正文Damage按R保护最高等级取BaseDamage索引1至最高等级。", 10);
  addCoefficient(add, "Kayn", "R", "Damage", "bonus_ad_ratio", "额外攻击力倍率", "新Damage计算树第二分支mStat=2、mStatFormula=2、系数1.5。", 20, 1);
  addFixedData(add, "Kayn", "R", "MinimumInfestTime", "minimum_infest_ms", "最短侵入时间（毫秒）", "INTEGER", "MinimumInfestTime=0.5秒，精确转换为500毫秒。", 30, toMs);
  addFixedData(add, "Kayn", "R", "InfestDuration", "max_infest_ms", "最长侵入时间（毫秒）", "INTEGER", "InfestDuration=2.5秒，精确转换为2500毫秒。", 40, toMs);
  addFixedData(add, "Kayn", "R", "JumpOutDistance", "jump_out_distance", "破体位移距离", "INTEGER", "普通形态JumpOutDistance=300。", 50);
  addFixedData(add, "Kayn", "R", "BaseCastRange", "base_cast_range", "基础施法距离", "INTEGER", "BaseCastRange=550；不使用旧动态正文的形态分支距离。", 60);
  addFixed(add, "mark_duration_ms", "被动标记持续时间（毫秒）", "INTEGER", toMs(3.15), "新动态正文spell_kayn_r_main_0明确标记3.15秒，精确转换为3150毫秒。", 70);
  addField(add, "Kayn", "R", "mCastTime", "cast_time_ms", "mCastTime（毫秒）", "INTEGER", "mCastTime=0.1秒，精确转换为100毫秒。", 80, 1, toMs);
  addFormula(formula("physical_damage", "裂舍影破体物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "新动态正文Damage=BaseDamage+1.5×来源额外攻击力。", 10));
  addEffect(damageEffect("damage", "裂舍影破体物理伤害", "physical_damage", "physical", "未变形主体破体伤害；标记/侵入时序和唯一敌人事件待接线。", 20));
  addManaIfReused("kayn_r", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["影流额外距离/刷新Q、暗裔最大生命伤害和治疗、变形专用分支排除。"], ["新动态正文要求标记3.15秒、最短0.5秒/最长2.5秒侵入；提前再次施放、标记资格、不可选取与破体时点待运行层接线。不得使用旧game_spell_kayn_r_main_0。"], "R严格使用spell_kayn_r_main_0动态正文，保留BaseDamage、1.5额外攻击力、550范围、300破体位移和100毫秒mCastTime。");

define("Viego", "P", "君命已决", (add, addFormula, addEffect) => {}, ["占据、复制技能装备、免费R和灵魂链全部按范围排除。"], ["不新增占据消耗或空伤害。"], "当前P是占据系统，主体保留但不创建本体写入。");

define("Viego", "Q", "破败王剑", (add, addFormula, addEffect) => {
  addSkill(add, "Viego", "Q", "Damage", "active_base_damage", "主动基础物理伤害", "INTEGER", "TotalDamage第一分支Damage按Q保护最高等级取索引1至最高等级。", 10);
  addFixedData(add, "Viego", "Q", "ActiveADRatio", "active_ad_ratio", "主动总攻击力倍率", "DECIMAL", "TotalDamage第二分支mStat=2，读取总攻击力0.7。", 20);
  addFixedData(add, "Viego", "Q", "ActiveCritMod", "active_crit_ratio", "主动暴击伤害效能", "DECIMAL", "TotalDamage根mStat8分支ActiveCritMod=0.6，乘完整主动段。", 30);
  addSkill(add, "Viego", "Q", "PercentHealthOnHit", "on_hit_current_health_percent_points", "攻击特效当前生命百分数点", "INTEGER", "PercentHealthOnHit按Q保护最高等级取索引1至最高等级，正文读攻击发生时目标当前生命。", 40);
  addSkill(add, "Viego", "Q", "MinDamageOnHit", "on_hit_min_damage", "攻击特效最低伤害", "INTEGER", "MinDamageOnHit保留10至30；最低值与百分比实际伤害的取大分支不以未支持MAX节点臆造。", 50);
  addFixedData(add, "Viego", "Q", "MarkDuration", "mark_duration_ms", "技能命中标记窗口（毫秒）", "INTEGER", "MarkDuration=4秒，精确转换为4000毫秒。", 60, toMs);
  addFixedData(add, "Viego", "Q", "HealthCritMod", "health_crit_ratio", "攻击特效暴击效能", "DECIMAL", "HealthCritDamage的mStat9分支HealthCritMod=0.7，不使用mStat8。", 70);
  addFixedData(add, "Viego", "Q", "SecondAttackAPRatio", "second_attack_ap_ratio", "二次打击法强倍率", "DECIMAL", "SecondAttackDamage第二分支读取0.15×来源总法强。", 80);
  addCoefficient(add, "Viego", "Q", "SecondAttackDamage", "second_attack_total_ad_ratio", "二次打击总攻击力倍率", "SecondAttackDamage第一分支mStat=2、系数0.2。", 90, 0);
  addFixed(add, "percent_point_ratio", "百分数点转比例", "DECIMAL", mNumber("Viego", "Q", "TotalPercentHealthOnHit"), "TotalPercentHealthOnHit根mNumber=0.01；Q攻击特效读取当前生命。", 100);
  addFixed(add, "crit_base_multiplier", "暴击倍率基准", "DECIMAL", 1, "TotalDamage根mSubparts第一项固定1。", 110);
  addFixed(add, "crit_subtract_one", "暴击倍率减一", "DECIMAL", -1, "TotalDamage与HealthCritDamage树均使用实际mStat9减1；固定负一来自源树。", 120);
  add(runtime("active_mstat8", "主动段实际mStat8", "DECIMAL", "TotalDamage实际mStat8未在本包属性枚举中证实，必须由运行层提供，不设默认。", 130));
  add(runtime("active_mstat9", "主动段实际mStat9", "DECIMAL", "TotalDamage实际mStat9未在本包属性枚举中证实，必须由运行层提供，不设默认。", 140));
  add(runtime("on_hit_crit_mstat9", "攻击特效实际mStat9", "DECIMAL", "HealthCritDamage实际mStat9未在本包属性枚举中证实，必须由运行层提供，不设默认。", 150));
  add(runtime("second_attack_current_hp", "二次攻击时目标当前生命", "DECIMAL", "第二次攻击的当前生命快照独立于主动/第一次攻击读取，运行层必须单独提供，不共享初始值。", 160));
  add(runtime("qualified_actual_damage_for_heal", "合资格实际伤害输入", "DECIMAL", "治疗只读取运行层判定后的合资格实际伤害；不以理论公式或候选伤害代替。", 170));
  addFixedData(add, "Viego", "Q", "HealModVsChamps", "heal_mod_vs_champs", "英雄治疗倍率", "DECIMAL", "HealModVsChamps=1.5；野怪/小兵治疗倍率排除。", 180);
  addField(add, "Viego", "Q", "mCastTime", "cast_time_ms", "mCastTime（毫秒）", "INTEGER", "mCastTime=0.25秒，精确转换为250毫秒；受攻击速度缩短的时序待运行层。", 190, 1, toMs);
  addField(add, "Viego", "Q", "castRange", "cast_range", "主动施法距离", "INTEGER", "当前根castRange=600。", 200);
  addFixedData(add, "Viego", "Q", "RectangleWidth", "rectangle_width", "主动判定宽度", "INTEGER", "RectangleWidth=125。", 210);
  const activeCritMultiplier = ADD(P("crit_base_multiplier"), MUL(P("active_crit_ratio"), MUL(P("active_mstat8"), ADD(P("active_mstat9"), P("crit_subtract_one")))));
  const activeBase = ADD(P("active_base_damage"), MUL(P("active_ad_ratio"), totalAD()));
  const onHitRatio = MUL(P("percent_point_ratio"), P("on_hit_current_health_percent_points"));
  const healthCritMultiplier = ADD(P("crit_base_multiplier"), MUL(P("health_crit_ratio"), ADD(P("on_hit_crit_mstat9"), P("crit_subtract_one"))));
  addFormula(formula("active_physical_damage", "破败王剑主动物理伤害", MUL(activeBase, activeCritMultiplier), "主动段=(基础+0.7×总攻击力)×[1+0.6×实际mStat8×(实际mStat9−1)]，暴击因子覆盖整段。", 10));
  addFormula(formula("on_hit_current_health_damage", "破败王剑第一次攻击当前生命伤害", MUL(onHitRatio, targetHP("CURRENT")), "第一次攻击特效=0.01×PercentHealthOnHit×攻击发生时目标当前生命。", 20));
  addFormula(formula("critical_on_hit_current_health_damage", "破败王剑二次攻击暴击当前生命伤害", MUL(MUL(onHitRatio, healthCritMultiplier), P("second_attack_current_hp")), "二次攻击额外特效=0.01×PercentHealthOnHit×[1+0.7×(实际mStat9−1)]×第二次攻击独立当前生命快照，不使用mStat8。", 30));
  addFormula(formula("second_attack_physical_damage", "破败王剑二次打击物理伤害", ADD(MUL(P("second_attack_total_ad_ratio"), totalAD()), MUL(P("second_attack_ap_ratio"), AP())), "SecondAttackDamage=0.2×来源总攻击力+0.15×来源总法强。", 40));
  addFormula(formula("second_attack_heal", "破败王剑二次打击治疗", MUL(P("qualified_actual_damage_for_heal"), P("heal_mod_vs_champs")), "治疗=1.5×运行层提供的合资格实际伤害；不使用理论伤害代替。", 50));
  addEffect(damageEffect("active_damage", "破败王剑主动物理伤害", "active_physical_damage", "physical", "主动段实际暴击因子已内联；触发策略与攻击速度时序待运行层接线。", 20));
  addEffect(damageEffect("on_hit_damage", "破败王剑第一次攻击当前生命伤害", "on_hit_current_health_damage", "physical", "第一次攻击读取目标当前生命；不与第二次攻击共享初始快照。", 30));
  addEffect(damageEffect("critical_on_hit_damage", "破败王剑二次攻击暴击当前生命伤害", "critical_on_hit_current_health_damage", "physical", "二次攻击暴击分支不含mStat8，且使用独立第二次当前生命输入；最低伤害条件仍待运行层取大。", 40));
  addEffect(damageEffect("second_attack_damage", "破败王剑二次打击物理伤害", "second_attack_physical_damage", "physical", "技能命中标记后的同一敌人二次打击；攻击特效与暴击资格待运行层接线。", 50));
  addEffect(directHealEffect("second_attack_heal", "破败王剑二次打击自身治疗", "second_attack_heal", "只保留英雄场景自身治疗；合资格实际伤害、占据期间保留和命中时点由运行层接线。", 60));
}, ["野怪/小兵治疗倍率、野怪上限、空BonusDamageVsMonsters和占据分支排除。"], ["mStat8/mStat9实际枚举、最低伤害取大、标记4秒、两次攻击事件、攻击特效/暴击触发与治疗资格待运行层接线；Q的两次当前生命不得共用同一初始快照。"], "保留TotalDamage、TotalPercentHealthOnHit、HealthCritDamage和SecondAttackDamage四棵当前消费树；主动段含mStat8，暴击攻击特效只含mStat9。");

define("Viego", "W", "千载幽咽", (add, addFormula, addEffect) => {
  addSkill(add, "Viego", "W", "Damage", "base_damage", "千载幽咽基础魔法伤害", "INTEGER", "Damage按W保护最高等级取索引1至最高等级。", 10);
  addFixedData(add, "Viego", "W", "APRatio", "ap_ratio", "法强倍率", "DECIMAL", "TotalDamage第二分支读取APRatio=1。", 20);
  addFixedData(add, "Viego", "W", "StunDuration", "min_stun_duration_ms", "最短眩晕持续时间（毫秒）", "INTEGER", "StunDuration=0.25秒，精确转换为250毫秒。", 30, toMs);
  addFixedData(add, "Viego", "W", "MaxStunTT", "max_stun_duration_ms", "最长眩晕持续时间（毫秒）", "INTEGER", "MaxStunTT=1.25秒，精确转换为1250毫秒；不当作蓄力时间。", 40, toMs);
  addSkill(add, "Viego", "W", "SelfSlowPercent", "self_slow_ratio", "蓄力自身减速比例", "DECIMAL", "SelfSlowPercent=0.1比例；减速持续实际随蓄力窗口由运行层提供。", 50);
  addSkill(add, "Viego", "W", "MaxChargeTime", "max_charge_time_ms", "最长蓄力时间（毫秒）", "INTEGER", "MaxChargeTime=3秒，精确转换为3000毫秒。", 60, toMs);
  addField(add, "Viego", "W", "mChannelDuration", "channel_duration_ms", "通道基础时间（毫秒）", "INTEGER", "mChannelDuration=1秒，精确转换为1000毫秒。", 70, 1, toMs);
  addFixedData(add, "Viego", "W", "CDWheninterrupted", "interrupted_cooldown_ms", "打断后冷却（毫秒）", "INTEGER", "CDWheninterrupted=3秒，精确转换为3000毫秒。", 80, toMs);
  addFixedData(add, "Viego", "W", "DashDistance", "dash_distance", "冲刺距离", "INTEGER", "DashDistance=300。", 90);
  addFixedData(add, "Viego", "W", "DashSpeed", "dash_speed", "冲刺速度", "INTEGER", "DashSpeed=1000。", 100);
  addFixedData(add, "Viego", "W", "MinMissileRange", "min_missile_range", "最短飞弹距离", "INTEGER", "MinMissileRange=500。", 110);
  addFixedData(add, "Viego", "W", "MaxBonusMissileRange", "max_bonus_missile_range", "最长飞弹额外距离", "INTEGER", "MaxBonusMissileRange=400。", 120);
  add(runtime("charge_duration_ms", "实际蓄力持续时间（毫秒）", "INTEGER", "自身减速效果的实际蓄力窗口未由源值曲线给出，必须由运行层提供，不设默认。", 125));
  addField(add, "Viego", "W", "spellCastTime", "spell_cast_time_ms", "spellCastTime（毫秒）", "INTEGER", "spellCastTime=0为阶段字段，精确保留0毫秒，不代表无时序。", 130, 0, toMs);
  addFormula(formula("magic_damage", "千载幽咽魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "TotalDamage=Damage+APRatio×来源总法强。", 10));
  addEffect(damageEffect("damage", "千载幽咽魔法伤害", "magic_damage", "magic", "第一个命中敌人的本体伤害；蓄力、晕眩和冲刺事件待接线。", 20));
  addEffect(attributeEffect("self_slow", "千载幽咽蓄力自身减速", "PARAMETER", "self_slow_ratio", "move_speed_percent", "charge_duration_ms", "蓄力期间自身减速比例；实际蓄力窗口由运行层提供，使用减法属性变化。", 30, "DECREASE", "SOURCE"));
}, ["无消耗、其他敌人、形态击飞和额外目标分支排除。"], ["实际蓄力时间、首次命中、晕眩随蓄力插值、打断、冲刺和spellCastTime=0阶段语义待运行层接线；不把1秒通道当最长晕眩。"], "保留min/max晕眩、1秒通道、3秒最大蓄力、3秒打断冷却和四个移动字段；自减速效果使用无默认运行时长。");

define("Viego", "E", "茫茫焦土", (add, addFormula, addEffect) => {
  addSkill(add, "Viego", "E", "MistDuration", "mist_duration_ms", "黑雾持续时间（毫秒）", "INTEGER", "MistDuration按保护最高等级逐级精确转换为8000毫秒。", 10, toMs);
  addSkill(add, "Viego", "E", "MoveSpeed", "move_speed_ratio", "黑雾内移动速度比例", "DECIMAL", "MoveSpeed已是0.25至0.35比例；按1=100%记录。", 20);
  addSkill(add, "Viego", "E", "AttackSpeed", "attack_speed_ratio", "黑雾内攻击速度比例", "DECIMAL", "AttackSpeed已是0.30至0.50比例；按1=100%记录。", 30);
  addFixedData(add, "Viego", "E", "CamoRadius", "camo_radius", "伪装显形范围", "INTEGER", "CamoRadius=450。", 40);
  addFixedData(add, "Viego", "E", "RestealthTime", "restealth_time_ms", "攻击/技能后显形时间（毫秒）", "INTEGER", "RestealthTime=0.6秒，精确转换为600毫秒。", 50, toMs);
  addFixedData(add, "Viego", "E", "MSAPRatio", "ms_ap_ratio", "移动速度法强倍率", "DECIMAL", "TotalMovespeed第二分支MSAPRatio=0.0004。", 60);
  addField(add, "Viego", "E", "castRangeDisplayOverride", "display_range", "显示距离", "INTEGER", "当前根显示距离750；原castRange25000不作实际距离。", 70);
  addField(add, "Viego", "E", "missileSpeed", "missile_speed", "幽鬼弹道速度", "INTEGER", "当前根missileSpeed=1200。", 80);
  addField(add, "Viego", "E", "spellCastTime", "spell_cast_time_ms", "spellCastTime（毫秒）", "INTEGER", "spellCastTime=0只保留阶段字段含义。", 90, 0, toMs);
  addFormula(formula("total_move_speed", "茫茫焦土自身移动速度", ADD(P("move_speed_ratio"), MUL(P("ms_ap_ratio"), AP())), "TotalMovespeed=MoveSpeed+0.0004×来源总法强。", 10));
  addEffect(attributeEffect("move_speed", "茫茫焦土自身移动速度", "FORMULA", "total_move_speed", "move_speed_percent", "mist_duration_ms", "只记录黑雾内自身移动速度；雾区第一个地形、伪装资格和显形事件待接线。", 20));
  addEffect(attributeEffect("attack_speed", "茫茫焦土自身攻击速度", "PARAMETER", "attack_speed_ratio", "bonus_attack_speed_percent", "mist_duration_ms", "只记录黑雾内自身额外攻击速度；冻结属性为bonus_attack_speed_percent，比例属性使用attribute_flat_add。", 30));
}, ["25000实际施法范围、野怪1.5秒显形、占据与其他单位分支排除。"], ["幽鬼命中第一个地形、黑雾覆盖、伪装、攻击/技能显形和0.6秒重新伪装事件待运行层接线。"], "保留TotalMovespeed、黑雾8秒和自身移速/攻速比例；显示距离与原始25000分开。");

define("Viego", "R", "痛贯天灵", (add, addFormula, addEffect) => {
  addSkill(add, "Viego", "R", "MaxHealthDamage", "missing_health_percent_points", "目标已损生命伤害百分数点", "INTEGER", "TotalPercentHealth第一分支MaxHealthDamage按R保护最高等级取索引1至最高等级；字段名不改变正文已损生命语义。", 10);
  addFixedData(add, "Viego", "R", "ADRatio", "total_ad_ratio", "基础攻击力倍率", "DECIMAL", "TotalDamage第一分支mStat=2读取1.2×来源总攻击力。", 20);
  addCoefficient(add, "Viego", "R", "TotalPercentHealth", "missing_health_bonus_ad_ratio", "已损生命额外攻击力倍率", "TotalPercentHealth第二分支mStat=2、mStatFormula=2、系数0.05读取来源额外攻击力。", 30, 1);
  addFixedData(add, "Viego", "R", "SlowPercent", "slow_ratio", "主目标减速比例", "DECIMAL", "SlowPercent=0.99比例，正文再乘100显示99%。", 40);
  addFixedData(add, "Viego", "R", "SlowDuration", "slow_duration_ms", "主目标减速持续时间（毫秒）", "INTEGER", "SlowDuration=0.25秒，精确转换为250毫秒。", 50, toMs);
  addFixedData(add, "Viego", "R", "CritMod", "crit_ratio", "基础段暴击效能", "DECIMAL", "TotalDamage根mStat8分支CritMod=0.7，仅用于总攻击力基础段。", 60);
  addFixed(add, "percent_point_ratio", "百分数点转比例", "DECIMAL", 0.01, "正文TotalPercentHealth以百分数点显示，固定转换系数0.01。", 70);
  addFixed(add, "crit_base_multiplier", "暴击倍率基准", "DECIMAL", 1, "TotalDamage树mSubparts第一项固定1。", 80);
  addFixed(add, "crit_subtract_one", "暴击倍率减一", "DECIMAL", -1, "TotalDamage树实际mStat9减1的固定负一。", 90);
  add(runtime("mstat8_actual", "基础段实际mStat8", "DECIMAL", "R的TotalDamage实际mStat8未在本包属性枚举中证实，必须由运行层提供，不设默认。", 100));
  add(runtime("mstat9_actual", "基础段实际mStat9", "DECIMAL", "R的TotalDamage实际mStat9未在本包属性枚举中证实，必须由运行层提供，不设默认。", 110));
  addField(add, "Viego", "R", "castRangeDisplayOverride", "display_range", "显示距离", "INTEGER", "当前根显示距离500；原castRange25000不作实际施法距离。", 120);
  const baseCritMultiplier = ADD(P("crit_base_multiplier"), MUL(P("crit_ratio"), MUL(P("mstat8_actual"), ADD(P("mstat9_actual"), P("crit_subtract_one")))));
  const baseDamage = MUL(MUL(P("total_ad_ratio"), totalAD()), baseCritMultiplier);
  const missingHealthSegment = MUL(MUL(P("percent_point_ratio"), ADD(P("missing_health_percent_points"), MUL(P("missing_health_bonus_ad_ratio"), bonusAD()))), targetHP("MISSING"));
  addFormula(formula("base_physical_damage", "痛贯天灵基础物理伤害", baseDamage, "TotalDamage=1.2×总攻击力×[1+0.7×实际mStat8×(实际mStat9−1)]，暴击因子只覆盖基础攻击力段。", 10));
  addFormula(formula("missing_health_physical_damage", "痛贯天灵目标已损生命物理伤害", missingHealthSegment, "TotalPercentHealth=0.01×(MaxHealthDamage+0.05×来源额外攻击力)×目标已损生命；不乘基础段暴击因子。", 20));
  addFormula(formula("physical_damage", "痛贯天灵主目标完整物理伤害", ADD(MUL(MUL(P("total_ad_ratio"), totalAD()), ADD(P("crit_base_multiplier"), MUL(P("crit_ratio"), MUL(P("mstat8_actual"), ADD(P("mstat9_actual"), P("crit_subtract_one")))))), MUL(MUL(P("percent_point_ratio"), ADD(P("missing_health_percent_points"), MUL(P("missing_health_bonus_ad_ratio"), bonusAD()))), targetHP("MISSING"))), "主目标完整伤害以内联树合并基础段与已损生命段，避免公式别名；其他敌人分配排除。", 30));
  addEffect(damageEffect("main_target_damage", "痛贯天灵主目标完整物理伤害", "physical_damage", "physical", "主目标基础攻击力段与已损生命段合并；攻击特效、99%减速和目标选择由运行层接线。", 20));
}, ["其他敌人击退/伤害、占据释放和直接处决事件排除；不为主目标之外新增效果。"], ["主目标选择、目标当时已损生命、攻击特效、暴击触发、99%减速和传送时点待运行层接线；R的mStat8/mStat9无默认输入。"], "保留TotalDamage与TotalPercentHealth两段，基础段含暴击因子，已损生命段不含暴击因子；主目标使用MISSING HP。");

const order = [
  "ivern_p", "ivern_q", "ivern_w", "ivern_e", "ivern_r",
  "yorick_p", "yorick_q", "yorick_w", "yorick_e", "yorick_r",
  "kayn_p", "kayn_q", "kayn_w", "kayn_e", "kayn_r",
  "viego_p", "viego_q", "viego_w", "viego_e", "viego_r",
];
assert(order.length === 20 && order.every(key => defs[key]), "20槽候选顺序不完整");

const reusedPublicParameters = reuseList.map(item => {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const hit = snapshotByRoute.get(route);
  assert(hit?.status === 200, `公共参数保护缺失：${route}`);
  return { skillKey: item.skillKey, parameterKey: item.parameterKey, source: "输入包/参考资料/公共参数复用清单.json", post: false, detailRoute: route, expected: clone(hit.data), expectedSha256: sha256(JSON.stringify(hit.data)) };
});

const sourceFiles = [];
for (const item of inputVersion.sourceFiles || []) {
  const file = path.join(INPUT, item.path.replaceAll("/", path.sep));
  assert(fs.existsSync(file), `输入源文件不存在：${item.path}`);
  const actual = shaFile(file);
  assert(actual === item.sha256, `输入源文件散列不一致：${item.path}`);
  sourceFiles.push({ path: `hero48-root-entry-20260910/${item.path}`, role: item.role, sha256: actual, byteSize: fs.statSync(file).size });
}
for (const [relative, file, role] of [
  ["来源绑定与当前文本.json", bindingFile, "当前绑定与原始对象索引"], ["输入版本.json", versionFile, "输入版本"], ["主负责人范围与核对要求.md", rangeFile, "主负责人范围要求"], ["主负责人源值核对说明.md", sourceNoteFile, "主负责人源值核对"], ["凯隐动态正文补充.json", dynamicFile, "凯隐动态正文键和值"], ["README.md", inputReadmeFile, "输入说明"],
]) sourceFiles.push({ path: `hero48-root-entry-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });
for (const [relative, file, role] of [["Cursor来源复核结论.md", cursorConclusionFile, "Cursor来源复核结论"], ["主负责人执行审计.json", cursorAuditFile, "Cursor执行审计元数据"], ["summary.json", cursorSummaryFile, "Cursor运行汇总"]]) sourceFiles.push({ path: `hero48-cursor-review-run-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });

const hashes = {
  sourceBindingSha256: shaFile(bindingFile), sourceRangeSha256: shaFile(rangeFile), sourceAuditSha256: shaFile(sourceNoteFile), dynamicTextSha256: shaFile(dynamicFile),
  cursorConclusionSha256: shaFile(cursorConclusionFile), cursorAuditSha256: shaFile(cursorAuditFile), cursorSummarySha256: shaFile(cursorSummaryFile), protectionSnapshotSha256: shaFile(protectionFile), publicReuseSha256: shaFile(reuseFile), inputVersionSha256: shaFile(versionFile), attributeNarrowSha256: shaFile(attributeFile), payloadSampleSha256: shaFile(payloadFile),
};
const generatedAt = new Date().toISOString();
const protectedCompositionCount = (protection.requests || []).filter(item => /\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(item.route)).length;
const candidate = {
  meta: {
    generatedAt, batch: BATCH, revision: REVISION, status: "候选已生成，来源与结构已冻结；未调用业务接口", gameId: "lol", apiBase: API_BASE, sourceVersion: SOURCE_VERSION,
    sourcePolicy: "固定客户端16.17、官方16.17.1、当前根绑定正文、凯隐动态正文补充和原始计算树；明确值入候选，未知曲线、资格、时序和实际属性用无默认运行输入或待接线说明。",
    scope: "艾翁、约里克、凯隐、佛耶戈20个技能槽；保留当前根本体伤害、控制、同敌重复、自身属性与基础资源，跳过完整变形、替换套装、召唤物、陷阱和兵野分支。艾翁E仅按输入资格补证保留自身，约里克R保留本人对室女标记目标附伤，凯隐R使用spell_kayn_r_main_0。",
    ...hashes, inputGETs: inputVersion.GETs, currentGETs: inputVersion.GETs, reusedPublicParameterCount: inputVersion.reusedParameters, apiCalls: 0, apiWrites: 0, businessWrites: 0, noBusinessWrites: true, tokenStored: false, candidateSha256: null,
    sourceReview: { conclusionFile: ".agents/artifacts/hero48-cursor-review-run-20260910/Cursor来源复核结论.md", conclusionSha256: hashes.cursorConclusionSha256, auditFile: ".agents/artifacts/hero48-cursor-review-run-20260910/主负责人执行审计.json", auditSha256: hashes.cursorAuditSha256, summaryFile: ".agents/artifacts/hero48-cursor-review-run-20260910/summary.json", summarySha256: hashes.cursorSummarySha256, verdict: "READY", runId: cursorAudit.runId, requestId: cursorAudit.requestId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, toolNames: clone(cursorAudit.toolNames || {}), inputsChecked: cursorAudit.inputsChecked, apiWrites: cursorAudit.apiWrites, gitDelta: cursorGitDelta, reviewedPlanRev: cursorAudit.reviewedPlanRev, note: "主负责人逐槽核对说明和实际Cursor复核作为当前消费优先依据；本候选未调用业务接口。" },
    dynamicTextSource: { file: "hero48-root-entry-20260910/凯隐动态正文补充.json", sha256: hashes.dynamicTextSha256, selectedKeys: clone(dynamicKeyBySlot), note: "凯隐Q/W/E/R当前动态正文分别按实际消费者键读取；R严格为spell_kayn_r_main_0。" },
    inputPackage: ".agents/artifacts/hero48-root-entry-20260910",
  },
  skills: Object.fromEntries(order.map(key => [key, defs[key]])), order, reusedPublicParameters, reusedExistingParameters: clone(reusedPublicParameters),
  counts: { newParameters: 0, newFormulas: 0, newEffects: 0, newProcesses: 0, newInternalStates: 0, newTriggerRules: 0, newTotal: 0, reusedPublicParameters: reusedPublicParameters.length, plannedTotalIncludingReused: 0, protectedCurrentCompositionLists: protectedCompositionCount },
  apiWrites: 0, sourceFiles,
  sourceNotes: { fixedClient: "输入包/参考资料/客户端原文/*.json.gz，客户端16.17完整对象", fixedOfficial: "输入包/参考资料/官方中文与官方英文，官方16.17.1", currentText: "输入包/来源绑定与当前文本.json的当前根绑定正文", dynamicText: "输入包/凯隐动态正文补充.json；按实际消费者键读取，R为spell_kayn_r_main_0", attributes: "输入包/参考资料/属性默认与边界.json只用于窄映射，未知运行属性保持无默认输入", payload: "输入包/参考资料/接口载荷样例.json只作结构参考，不复制数值" },
  protectedObjects: { snapshot: "输入包/参考资料/当前20槽保护快照.json", snapshotSha256: hashes.protectionSnapshotSha256, inputGETs: protection.GETs, requestCount: protection.requests.length, routes: protectedRouteHashes, publicReuse: clone(reusedPublicParameters), note: "193条只读保护覆盖字典、角色、关系、20个技能主体及组成列表；21项公共参数只读复用。" }, revision: REVISION,
};
for (const key of order) for (const [kind, countKey] of Object.entries({ parameters: "newParameters", formulas: "newFormulas", effects: "newEffects", processes: "newProcesses", internalStates: "newInternalStates", triggerRules: "newTriggerRules" })) candidate.counts[countKey] += defs[key].write[kind].length;
candidate.counts.newTotal = Object.entries(candidate.counts).filter(([key]) => key.startsWith("new") && key !== "newTotal").reduce((sum, [, value]) => sum + value, 0);
candidate.counts.plannedTotalIncludingReused = candidate.counts.newTotal + candidate.counts.reusedPublicParameters;

const scope = {
  generatedAt, batch: BATCH, revision: REVISION, status: "来源值与录入范围清单；未调用业务接口", inputGETs: inputVersion.GETs, reusedPublicParameters: reusedPublicParameters.length,
  sourceBindingSha256: hashes.sourceBindingSha256, sourceRangeSha256: hashes.sourceRangeSha256, sourceAuditSha256: hashes.sourceAuditSha256, dynamicTextSha256: hashes.dynamicTextSha256, cursorConclusionSha256: hashes.cursorConclusionSha256, cursorAuditSha256: hashes.cursorAuditSha256, cursorSummarySha256: hashes.cursorSummarySha256, sourceReviewVerdict: "READY", fixedVersions: SOURCE_VERSION,
  globalScope: { included: ["当前根本体伤害与控制", "同一敌人的连续命中", "自身属性与基础资源", "当前消费的匿名或tooltipOnly计算树", "唯一敌方英雄场景"], excluded: ["完整变形与替换技能套装", "独立召唤物、灵墙和陷阱", "兵野与建筑专用分支", "额外敌人分配", "纯视野", "未证实际插值或距离曲线"], unknownPolicy: "未知曲线、实际命中次数、未证属性和事件时序用无默认运行输入或待接线说明，不用0占位；艾翁E自身资格保持输入补证的有限范围，不扩友方或小菊。" },
  skills: Object.fromEntries(order.map(key => [key, { maxLevel: defs[key].maxLevel, recordableParameters: defs[key].write.parameters.map(item => item.parameterKey), recordableFormulas: defs[key].write.formulas.map(item => item.formulaKey), recordableEffects: defs[key].write.effects.map(item => item.effectKey), excluded: clone(defs[key].excluded), pending: clone(defs[key].pending), currentSubjectProtected: defs[key].protectedExisting.subject }])), noApiCalls: true, apiWrites: 0,
};
const requests = [];
for (const key of order) for (const [kind, idField, apiName] of [["parameters", "parameterKey", "parameters"], ["formulas", "formulaKey", "formulas"], ["effects", "effectKey", "effects"], ["processes", "processKey", "processes"], ["internalStates", "stateKey", "internal-states"], ["triggerRules", "ruleKey", "trigger-rules"]]) for (const body of defs[key].write[kind]) requests.push({ sequence: requests.length + 1, operation: "POST", method: "POST", route: `/skills/${key}/${apiName}`, detailRoute: `/skills/${key}/${apiName}/${body[idField]}`, skillKey: key, kind, stableKey: body[idField], status: "仅意图，未调用", body: clone(body) });
assert(requests.length === candidate.counts.newTotal, "POST计划数量与候选数量不符");
const candidateBytes = jsonBytes(candidate); const candidateSha256 = sha256(candidateBytes); candidate.meta.candidateSha256 = candidateSha256;
const scopeBytes = jsonBytes(scope); const scopeSha256 = sha256(scopeBytes);
const plan = { generatedAt, status: "仅写入意图，未调用业务接口", batch: BATCH, revision: REVISION, apiBase: API_BASE, sourceVersion: SOURCE_VERSION, candidateSha256, sourceBindingSha256: hashes.sourceBindingSha256, sourceRangeSha256: scopeSha256, inputSourceRangeSha256: hashes.sourceRangeSha256, sourceAuditSha256: hashes.sourceAuditSha256, dynamicTextSha256: hashes.dynamicTextSha256, cursorConclusionSha256: hashes.cursorConclusionSha256, cursorAuditSha256: hashes.cursorAuditSha256, cursorSummarySha256: hashes.cursorSummarySha256, protectionSnapshotSha256: hashes.protectionSnapshotSha256, publicReuseSha256: hashes.publicReuseSha256, requestCount: requests.length, counts: clone(candidate.counts), reusedPublicParameters: clone(reusedPublicParameters), protectedRoutes: protectedRouteHashes, protectedSummary: { inputGETs: protection.GETs, inputRequestCount: protection.requests.length, currentCompositionLists: protectedCompositionCount, note: "写入前逐条只读保护；本计划不覆盖已有主体和组成。" }, requests, noApiCalls: true, apiWrites: 0, businessWrites: 0 };
const planBytes = jsonBytes(plan); const planSha256 = sha256(planBytes);
const sourceValues = { generatedAt, batch: BATCH, revision: REVISION, status: "独立源值清单；未调用业务接口", sourceBindingSha256: hashes.sourceBindingSha256, sourceAuditSha256: hashes.sourceAuditSha256, dynamicTextSha256: hashes.dynamicTextSha256, cursorConclusionSha256: hashes.cursorConclusionSha256, cursorAuditSha256: hashes.cursorAuditSha256, cursorSummarySha256: hashes.cursorSummarySha256, sourceFiles: clone(sourceFiles), sourceValues: Object.fromEntries(order.map(key => { const value = defs[key].source; return [key, { hero: value.hero, heroName: value.heroName, slot: value.slot, rootPath: value.rootPath, spellPath: value.spellPath, currentText: clone(value.currentBoundText), dynamicText: clone(value.dynamicText), officialZh: clone(value.officialEvidence.zh), officialEn: clone(value.officialEvidence.en), rawDataValues: clone(value.raw.dataValues), rawCalculations: clone(value.raw.calculations), rawFields: clone(value.raw.fields), selectedParameterKeys: defs[key].write.parameters.map(item => item.parameterKey), selectedFormulaKeys: defs[key].write.formulas.map(item => item.formulaKey), selectedEffectKeys: defs[key].write.effects.map(item => item.effectKey), excluded: clone(defs[key].excluded), pending: clone(defs[key].pending) }]; })), noApiCalls: true, apiWrites: 0 };
const sourceValuesBytes = jsonBytes(sourceValues); const sourceValuesSha256 = sha256(sourceValuesBytes);
const version = { generatedAt, batch: BATCH, revision: REVISION, status: "候选冻结，待主负责人审查；未调用业务接口", candidateSha256, planSha256, scopeSha256, sourceValuesSha256, ...hashes, counts: clone(candidate.counts), requestCount: requests.length, sourceMath: "独立数学核算.mjs", sourceMathStatus: "脚本已生成，待执行", cursorVerdict: "READY", cursorRunId: cursorAudit.runId, cursorEvents: cursorAudit.events, cursorUniqueTools: cursorAudit.uniqueTools, cursorInputsChecked: cursorAudit.inputsChecked, apiCalls: 0, apiWrites: 0, businessWrites: 0, noBusinessWrites: true };
const freezeNotice = { generatedAt, batch: BATCH, revision: REVISION, candidateSha256, planSha256, scopeSha256, sourceValuesSha256, dynamicTextSha256: hashes.dynamicTextSha256, cursorConclusionSha256: hashes.cursorConclusionSha256, cursorAuditSha256: hashes.cursorAuditSha256, cursorSummarySha256: hashes.cursorSummarySha256, counts: clone(candidate.counts), requestCount: requests.length, inputGETs: inputVersion.GETs, reusedPublicParameters: reusedPublicParameters.length, cursorVerdict: "READY", cursorRunId: cursorAudit.runId, cursorEvents: cursorAudit.events, cursorUniqueTools: cursorAudit.uniqueTools, cursorInputsChecked: cursorAudit.inputsChecked, apiCalls: 0, apiWrites: 0, businessWrites: 0, status: "冻结候选，等待独立数学核算；未调用业务接口" };
const freezeBytes = jsonBytes(freezeNotice); const generatorBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const outputs = { "完整候选.json": candidateBytes, "请求计划.json": planBytes, "来源与范围.json": scopeBytes, "来源值摘要.json": sourceValuesBytes, "候选版本.json": jsonBytes(version), "来源冻结通知.json": freezeBytes, "生成候选.mjs": generatorBytes };
const hashesSummary = { generatedAt, batch: BATCH, revision: REVISION, status: "候选输出文件散列；未调用业务接口", sourceFiles: clone(sourceFiles), outputFiles: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, { sha256: sha256(bytes), byteSize: bytes.length }])), sourceHashes: hashes, cursorReview: { verdict: "READY", runId: cursorAudit.runId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, inputsChecked: cursorAudit.inputsChecked }, noApiCalls: true, apiWrites: 0 };
const readme = [
  "# 第四十八批候选", "",
  "本目录保存艾翁、约里克、凯隐、佛耶戈20个技能槽的候选组成。来源固定客户端16.17、官方16.17.1、当前根绑定正文、凯隐动态正文补充和原始计算树；实际Cursor复核为READY，主负责人审计只读。", "",
  "候选只生成写入意图，未调用接口。193条只读输入保护20个技能主体和组成列表，21项公共参数只读复用；当前消费的计算树、源数组索引和等级边界均在来源摘要中保留。", "",
  "范围保留当前根本体伤害、控制、同一敌人重复命中、自身属性与基础资源；完整变形、替换套装、独立召唤物、灵墙、陷阱、兵野专用分支和额外敌人分配排除。艾翁E只按输入资格补证保留自身，约里克R保留本人对室女标记目标附伤。", "",
  "凯隐动态正文按实际消费者键保存：Q/W/E分别使用game_spell_kayn_q_main_0、game_spell_kayn_w_maintext_0、game_spell_kayn_e_main_0，R严格使用spell_kayn_r_main_0；Q的tooltipOnly总伤害保留。", "",
  "佛耶戈Q主动段读取总攻击力和当前生命，R基础段读取总攻击力、已损生命段读取目标MISSING HP；mStat8/mStat9保持无默认实际输入，Q两次攻击当前生命快照分开。约里克Q的QHeal保持无默认真实输入，不编断点曲线。", "",
  "公式全部为PARAMETER、ATTRIBUTE、OPERATION三类节点，操作严格二元；比例属性使用attribute_flat_add；明确时间精确换算为整数毫秒；未知曲线、实际命中次数、属性和事件时序用无默认运行输入或待接线说明。", "",
  "独立数学核算从冻结输入的DataValues、计算树、动态正文和当前文本独立求期望值，逐公式提供至少两个场景、缺输入拒绝、完整等级、源数组索引、整数毫秒、二元树、效果最终倍率和比例属性乘区检查。", "",
  "本目录与交叉试录目录均为静态候选证据，不表示真实数据库、运行时、页面或战斗已完成。", "",
].join("\n");
Object.assign(outputs, { "来源哈希汇总.json": jsonBytes(hashesSummary), "README.md": Buffer.from(readme, "utf8") });
for (const [name, bytes] of Object.entries(outputs)) { writeBytes(path.join(ROOT, name), bytes); writeBytes(path.join(DURABLE, name), bytes); }
const manifest = { generatedAt, batch: BATCH, revision: REVISION, files: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, { sha256: sha256(bytes), byteSize: bytes.length }])), sourceHashes: hashes, cursorReview: { verdict: "READY", runId: cursorAudit.runId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, inputsChecked: cursorAudit.inputsChecked }, noApiCalls: true, apiWrites: 0 };
writeJson(path.join(ROOT, "文件散列.json"), manifest); writeJson(path.join(DURABLE, "文件散列.json"), manifest);
console.log(JSON.stringify({ candidateSha256, planSha256, scopeSha256, sourceValuesSha256, counts: candidate.counts, requestCount: requests.length, protectedCompositionCount, cursor: { verdict: "READY", runId: cursorAudit.runId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, inputsChecked: cursorAudit.inputsChecked }, root: ROOT, durable: DURABLE, apiCalls: 0, apiWrites: 0 }, null, 2));
