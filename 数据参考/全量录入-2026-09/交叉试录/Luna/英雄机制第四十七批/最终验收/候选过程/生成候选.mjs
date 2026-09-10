import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero47-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十七批");
const REVIEW = path.resolve(ROOT, "..", "hero47-cursor-review-run-20260910");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "英雄机制第四十七批伊莉丝杰斯奈德丽希瓦娜";
const REVISION = "hero47-source-v1-luna-candidate-revision1";
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
const seconds = value => {
  const raw = Number(value);
  assert(Number.isFinite(raw) && raw >= 0, `时间不是非负有限秒数：${value}`);
  return raw;
};
const percentPoints = value => norm(Number(value) * 100);

const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const versionFile = path.join(INPUT, "输入版本.json");
const rangeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const sourceNoteFile = path.join(INPUT, "主负责人源值核对说明.md");
const inputReadmeFile = path.join(INPUT, "README.md");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const cursorConclusionFile = path.join(REVIEW, "Cursor来源复核结论.md");
const cursorAuditFile = path.join(REVIEW, "主负责人执行审计.json");
const QUALIFICATION = path.resolve(ROOT, "..", "hero47-qualification-review");
const qualificationFile = path.join(QUALIFICATION, "资格审查.json");
const qualificationExcerptFile = path.join(QUALIFICATION, "来源摘录.md");
const qualificationReadmeFile = path.join(QUALIFICATION, "README.md");
const qualificationManifestFile = path.join(QUALIFICATION, "文件散列.json");
for (const file of [
  bindingFile, versionFile, rangeFile, sourceNoteFile, inputReadmeFile,
  protectionFile, reuseFile, attributeFile, payloadFile, cursorConclusionFile, cursorAuditFile,
  qualificationFile, qualificationExcerptFile, qualificationReadmeFile, qualificationManifestFile,
]) assert(fs.existsSync(file), `缺少冻结输入：${file}`);

const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const cursorAudit = readJson(cursorAuditFile);
const qualificationReview = readJson(qualificationFile);
const qualificationManifest = readJson(qualificationManifestFile);
const cursorConclusion = fs.readFileSync(cursorConclusionFile, "utf8");
assert(binding.clientVersion === SOURCE_VERSION.clientVersion, "客户端版本不符");
assert(binding.officialVersion === SOURCE_VERSION.officialVersion, "官方版本不符");
assert(inputVersion.GETs === 193 && inputVersion.reusedParameters === 21, "第四十七批输入计数不符");
assert(inputVersion.apiWrites === 0, "冻结输入已有业务写入");
assert(cursorAudit.inputsChecked === 24 && cursorAudit.apiWrites === 0, "Cursor审计输入或写入计数不符");
const cursorGitDelta = Array.isArray(cursorAudit.gitDelta) ? cursorAudit.gitDelta.length : Number(cursorAudit.gitDelta || 0);
assert(cursorGitDelta === 0, "Cursor审计存在Git变化");
assert(/READY|通过|完成/.test(cursorConclusion), "Cursor来源复核结论没有完成标记");
assert(qualificationReview.status === "READY", "第47批资格复核没有READY标记");
assert(qualificationReview.scope?.candidateChanged === false && qualificationReview.scope?.rootInputChanged === false, "第47批资格复核改动了候选或根输入");
assert(qualificationReview.scope?.apiCalls === 0 && qualificationReview.scope?.apiWrites === 0 && qualificationReview.scope?.databaseCalls === 0 && qualificationReview.scope?.browserCalls === 0 && qualificationReview.scope?.gitWrites === 0, "第47批资格复核存在业务调用或Git写入");
const qualificationBySkill = Object.fromEntries((qualificationReview.conclusions || []).map(item => [item.skillKey, item]));
assert(qualificationBySkill.elise_w?.recordingDecision?.includes("本体技能载体处理"), "伊莉丝W资格结论缺少本体技能载体判定");
assert(qualificationBySkill.nidalee_e?.recordingDecision?.includes("仅保留自身"), "奈德丽E资格结论缺少仅保留自身判定");
assert(qualificationManifest.reviewId === qualificationReview.reviewId, "资格复核散列清单版本不符");

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
const dataAt = (heroId, slot, name, index = 1) => dataRow(heroId, slot, name)[index];
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
const calculation = (heroId, slot, name) => {
  const value = (spell(heroId, slot).mSpellCalculations || {})[name];
  assert(value, `缺少计算树：${heroId}/${slot}/${name}`);
  return value;
};
const coefficient = (heroId, slot, calculationName, index = 1) => {
  const part = (calculation(heroId, slot, calculationName).mFormulaParts || [])[index];
  assert(part && typeof part.mCoefficient === "number", `缺少树系数：${heroId}/${slot}/${calculationName}/${index}`);
  return norm(part.mCoefficient);
};
const namedPart = (heroId, slot, calculationName, index = 0) => {
  const part = (calculation(heroId, slot, calculationName).mFormulaParts || [])[index];
  assert(part && typeof part.mDataValue === "string", `缺少具名数据树分支：${heroId}/${slot}/${calculationName}/${index}`);
  return part.mDataValue;
};
const mNumber = (heroId, slot, calculationName) => {
  const value = calculation(heroId, slot, calculationName).mMultiplier?.mNumber;
  assert(typeof value === "number", `缺少树固定倍率：${heroId}/${slot}/${calculationName}`);
  return norm(value);
};
const fixedTimeMs = (heroId, slot, name) => {
  const value = field(heroId, slot, name);
  assert(typeof value === "number", `缺少时间字段：${heroId}/${slot}/${name}`);
  return toMs(value);
};
const officialFor = (heroId, slot, english = false) => {
  const file = path.join(INPUT, "参考资料", english ? "官方英文" : "官方中文", `${heroId}.json`);
  const root = readJson(file).data[heroId];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};
const targetHP = kind => ({ nodeType: "ATTRIBUTE", attributeOwner: "TARGET", attributeKey: "hp", attributeValueKind: kind });
const sourceHPBonus = () => ({ nodeType: "ATTRIBUTE", attributeOwner: "SOURCE", attributeKey: "hp", attributeValueKind: "BONUS" });
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
const lifecycle = durationKey => ({
  durationValue: durationKey ? { kind: "PARAMETER", parameterKey: durationKey } : null,
  maxStacksValue: { kind: "FIXED", value: 1 },
  applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope: "SOURCE",
  reapplicationStackMode: "KEEP",
  reapplicationDurationMode: durationKey ? "REFRESH_ALL" : null,
  expiryMode: durationKey ? "ALL_AT_ONCE" : "EXPLICIT_ONLY",
  periodicIntervalValue: null,
  firstPeriodicExecution: null,
});
const persistentResultLifecycle = () => ({
  moment: "PERSISTENT",
  valueReadMode: "APPLICATION_SNAPSHOT",
  stackValueMode: "SHARED",
  reapplicationValueMode: "REPLACE",
  periodicExecutionMode: null,
});
const valueRule = (kind, key) => ({
  value: { kind, [kind === "PARAMETER" ? "parameterKey" : "formulaKey"]: key },
  fixedMultiplier: 1,
  fixedMinValue: 0,
  fixedMaxValue: null,
});
const resourceEffect = (effectKey, name, parameterKey, operation, description, sortOrder = 900) => ({
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
    description: "不表示战斗事件已经接线。",
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: valueRule("PARAMETER", parameterKey),
    detail: { attributeKey: "mana", operation },
  }],
});
const attributeEffect = (effectKey, name, valueKind, valueKey, attributeKey, durationKey, description, sortOrder = 20) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: lifecycle(durationKey),
  results: [{
    resultKey: "attribute",
    name,
    resultType: "ATTRIBUTE_CHANGE",
    target: "SOURCE",
    description: "只定义自身属性变化，触发条件由事件层接线。",
    sortOrder: 10,
    lifecycleBehavior: persistentResultLifecycle(),
    spellShieldBlockScope: null,
    valueRule: valueRule(valueKind, valueKey),
    detail: { attributeKey, operation: "INCREASE", modifierZoneKey: "attribute_flat_add" },
  }],
});
const shieldEffect = (effectKey, name, formulaKey, durationKey, description, sortOrder = 20) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: lifecycle(durationKey),
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
const cooldownEffect = (effectKey, name, parameterKey, affectedSkillKeys, description, sortOrder = 30) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: null,
  results: [{
    resultKey: "reduce_cooldown",
    name,
    resultType: "COOLDOWN_CHANGE",
    target: "SOURCE",
    description: "只影响指定技能，命中条件和实际扣减时点由事件层接线。",
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
const damageEffect = (effectKey, name, formulaKey, damageTypeKey, description, sortOrder = 20) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: null,
  results: [{
    resultKey: "damage",
    name,
    resultType: "DAMAGE",
    target: "TARGET",
    description: "一次技能伤害结果；爆炸载体分类与事件接线分开记录。",
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: "RESULT",
    valueRule: valueRule("FORMULA", formulaKey),
    detail: {
      damageTypeKey,
      deliveryKind: "SKILL",
      originKind: "DIRECT",
      critical: { mode: "DISALLOWED", multiplierValue: null },
      vampRules: [],
    },
  }],
});
const directHealEffect = (effectKey, name, formulaKey, description, sortOrder = 20) => ({
  effectKey,
  name,
  description,
  sortOrder,
  lifecycle: null,
  results: [{
    resultKey: "heal",
    name,
    resultType: "DIRECT_HEAL",
    target: "SOURCE",
    description: "只记录奈德丽自身的直接治疗结果；友方目标分配由本轮范围排除。",
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: valueRule("FORMULA", formulaKey),
    detail: {},
  }],
});

const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const bindingSkill = skillAt(heroId, slot);
  const rawSpell = bindingSkill.object.mSpell;
  const sourceMeta = (hero.source.skills || []).find(item => item.slot === slot) || {};
  const clientFile = path.join(INPUT, "参考资料", "客户端原文", `${heroId}.json.gz`);
  const officialZhFile = path.join(INPUT, "参考资料", "官方中文", `${heroId}.json`);
  const officialEnFile = path.join(INPUT, "参考资料", "官方英文", `${heroId}.json`);
  return {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    slot,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath,
    spellPath: sourceMeta.clientPath || bindingSkill.binding,
    bindingAvailable: sourceMeta.bindingAvailable ?? true,
    clientFile: `参考资料/客户端原文/${heroId}.json.gz`,
    clientSha256: hero.source.client.sha256,
    clientCompressedSha256: shaFile(clientFile),
    clientContentSha256: hero.source.client.sha256,
    clientBuild: hero.source.client.contentVersion,
    officialZhFile: `参考资料/官方中文/${heroId}.json`,
    officialZhSha256: shaFile(officialZhFile),
    officialEnFile: `参考资料/官方英文/${heroId}.json`,
    officialEnSha256: shaFile(officialEnFile),
    currentBoundText: clone(bindingSkill.currentTexts),
    raw: {
      dataValues: Object.fromEntries((rawSpell.DataValues || []).map(row => [row.name, row.values ? clone(row.values) : null])),
      calculations: clone(rawSpell.mSpellCalculations || {}),
      fields: Object.fromEntries([
        "mEffectAmount", "mCastTime", "spellCastTime", "spellTotalTime", "mChannelDuration", "cooldownTime",
        "Cooldown", "mana", "manaValues", "mMaxAmmo", "mAmmoRechargeTime", "mDoesNotConsumeMana",
        "mDoesNotConsumeCooldown", "mTargetingTypeData", "mClientData", "castRange", "castRangeDisplayOverride",
        "castRadius", "missileSpeed", "mMissileSpec", "mSpellTags", "mAffectsTypeFlags",
      ].map(key => [key, rawSpell[key] ?? null])),
    },
    officialEvidence: { zh: clone(officialFor(heroId, slot)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}/currentTexts`,
    officialMaxRank: sourceMeta.officialMaxRank ?? null,
  };
};

const defs = {};
const define = (heroId, slot, title, build, excluded, pending, proofNote) => {
  const skillKey = `${heroId.toLowerCase()}_${slot.toLowerCase()}`;
  const write = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  const add = item => {
    if (!item || !item.parameterKey || reuseSet.has(`${skillKey}/${item.parameterKey}`)) return;
    assert(!write.parameters.some(existing => existing.parameterKey === item.parameterKey), `重复参数：${skillKey}/${item.parameterKey}`);
    write.parameters.push(item);
  };
  const addFormula = item => {
    assert(!write.formulas.some(existing => existing.formulaKey === item.formulaKey), `重复公式：${skillKey}/${item.formulaKey}`);
    write.formulas.push(item);
  };
  const addEffect = item => {
    assert(!write.effects.some(existing => existing.effectKey === item.effectKey), `重复效果：${skillKey}/${item.effectKey}`);
    write.effects.push(item);
  };
  const subject = snapshotByRoute.get(`/skills/${skillKey}`);
  assert(subject?.status === 200, `缺少受保护技能主体：${skillKey}`);
  build(add, addFormula, addEffect);
  defs[skillKey] = {
    skillKey,
    name: `${heroes[heroId].name}·${title}`,
    maxLevel: subject.data.maxLevel,
    source: sourceFor(heroId, slot),
    write,
    protectedExisting: { subject: true, compositionLists: true, protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json" },
    excluded,
    pending,
    proofs: [
      { type: "root-bound-source", path: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}` },
      { type: "fixed-source-version", client: SOURCE_VERSION.clientVersion, official: SOURCE_VERSION.officialVersion, build: SOURCE_VERSION.build },
      { type: "cursor-source-review", runId: cursorAudit.runId, verdict: "READY", reviewedPlanRev: cursorAudit.reviewedPlanRev || null },
    ],
    proofNote,
    currentSubject: clone(subject.data),
  };
};
const addManaIfReused = (skillKey, addEffect, description) => {
  if (reuseSet.has(`${skillKey}/mana_cost`)) addEffect(resourceEffect("mana_cost", "施放法力消耗", "mana_cost", "CONSUME", description));
};
const addSkill = (add, heroId, slot, dataName, count, key, name, type, description, order, transform = value => value) => {
  add(skill(key, name, type, levelValues(heroId, slot, dataName, count, 1, transform), description, order));
};
const addFixedData = (add, heroId, slot, dataName, key, name, type, description, order, transform = value => norm(value), index = 1) => {
  add(fixedRaw(key, name, type, transform(dataAt(heroId, slot, dataName, index)), description, order));
};
const addCoefficient = (add, heroId, slot, calcName, key, name, description, order, index = 1) => {
  add(fixedRaw(key, name, "DECIMAL", coefficient(heroId, slot, calcName, index), description, order));
};
const addField = (add, heroId, slot, fieldName, key, name, type, description, order, index = 1, transform = value => norm(value)) => {
  add(fixedRaw(key, name, type, transform(fixedField(heroId, slot, fieldName, index, value => value)), description, order));
};

define("Elise", "P", "蜘蛛女皇", (add, addFormula, addEffect) => {}, [
  "蜘蛛形态的普攻附伤、回血和小蜘蛛准备均依赖完整变形或独立召唤单位，本轮不制造本体伤害。",
], [
  "蜘蛛形态切换、小蜘蛛生成和攻击链需后续完整形态与召唤单位能力。",
], "当前人类部分只准备小蜘蛛；当前匿名等级树不被误录为本体伤害。");

define("Elise", "Q", "神经毒素 / 剧毒之蜇", (add, addFormula, addEffect) => {
  addSkill(add, "Elise", "Q", "BaseDamage", 5, "base_damage", "人类形态基础魔法伤害", "INTEGER", "当前根DataValue.BaseDamage索引1至5为40/70/100/130/160；索引0=10不作技能1级。", 10);
  addSkill(add, "Elise", "Q", "TargetHPDamage", 5, "target_current_health_percent_points", "目标当前生命伤害百分数点", "INTEGER", "HumanPercentHealth读取TargetHPDamage索引1至5为4百分数点；伤害目标是当前生命。", 20);
  addFixedData(add, "Elise", "Q", "APRatio", "ap_ratio", "目标当前生命伤害法强倍率", "DECIMAL", "HumanPercentHealth第二分支读取APRatio；与当前生命项一起乘0.01。", 30);
  add(fixedRaw("percent_point_ratio", "百分数点转比例", "DECIMAL", mNumber("Elise", "Q", "HumanPercentHealth"), "HumanPercentHealth树mMultiplier=0.01；4百分数点先与0.03×法强相加，再乘0.01和目标当前生命。", 40));
  addField(add, "Elise", "Q", "castRange", "cast_range", "人类形态施法距离", "INTEGER", "当前根castRange=575；与显示距离分开。", 50);
  addField(add, "Elise", "Q", "castRangeDisplayOverride", "display_range", "人类形态显示距离", "INTEGER", "当前根castRangeDisplayOverride=615；不与实际施法距离混用。", 60);
  addField(add, "Elise", "Q", "missileSpeed", "missile_speed", "人类形态弹道速度", "INTEGER", "当前根missileSpeed=2200。", 70);
  const ratioPart = MUL(ADD(P("target_current_health_percent_points"), MUL(P("ap_ratio"), AP())), MUL(P("percent_point_ratio"), targetHP("CURRENT")));
  addFormula(formula("current_health_magic_damage", "神经毒素目标当前生命附加魔法伤害", ratioPart, "HumanPercentHealth=0.01×(TargetHPDamage+APRatio×来源法强)×目标当前生命。", 10));
  addFormula(formula("human_magic_damage", "神经毒素人类形态魔法伤害", ADD(P("base_damage"), ratioPart), "人类形态总伤害=基础值+目标当前生命×[0.01×(4+0.03×来源法强)]。", 20));
  addManaIfReused("elise_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, [
  "野怪伤害上限与蜘蛛形态剧毒之蜇分支排除。",
], [
  "0.25秒与0.125秒施法字段冲突，不任选；命中时点待运行层接线。",
  "目标当前生命输入必须由运行层提供，不以目标最大或已损生命替代。",
], "当前文本消费HumanPercentHealth；源数组按技能索引1至5，射程、显示距离和弹速分别记录。");

define("Elise", "W", "自爆蜘蛛 / 掠行狂暴", (add, addFormula, addEffect) => {
  addSkill(add, "Elise", "W", "BaseDamage", 5, "base_damage", "爆炸基础魔法伤害", "INTEGER", "当前根BaseDamage索引1至5为60/100/140/180/220。", 10);
  addFixedData(add, "Elise", "W", "APRatio", "ap_ratio", "爆炸法强倍率", "DECIMAL", "TotalDamage读取APRatio=0.75。", 20);
  addFixedData(add, "Elise", "W", "TimeToExplode", "explosion_delay_ms", "爆炸延迟（毫秒）", "INTEGER", "接近敌人或3秒后爆炸；TimeToExplode=3秒转换为3000毫秒。", 30, toMs);
  addFixedData(add, "Elise", "W", "ExplosionSize", "explosion_radius", "爆炸半径", "INTEGER", "当前根ExplosionSize=275。", 40);
  addField(add, "Elise", "W", "spellCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.125秒，转换为125毫秒。", 50, 1, toMs);
  addFormula(formula("magic_damage", "自爆蜘蛛爆炸魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "TotalDamage=基础值+0.75×来源总法强；资格审查按一次施放、一次爆炸的本体技能伤害载体处理。", 10));
  addEffect(damageEffect("explosion_damage", "自爆蜘蛛一次爆炸魔法伤害", "magic_damage", "magic", "资格审查根据单一SpellObject、直接伤害树和一次爆炸语义作出有界结构推断；不建立独立召唤单位生命或持续攻击链，接近敌人/3秒爆炸事件仍待运行层接线。", 20));
  addManaIfReused("elise_w", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, [
  "蜘蛛形态攻速和兵野专用分支排除。",
], [
  "资格审查已按一次施放、一次爆炸的本体技能伤害载体处理；敌方是否能单独选中或击杀仍待运行层核对，不建立独立单位接线。",
  "接近敌人或3秒后爆炸的事件资格待运行层接线。",
], "当前根TotalDamage与爆炸延迟/半径均有明确值；保留唯一敌人单次爆炸伤害效果，结构分类依据资格审查的静态推断，不宣称运行层已完成。");

define("Elise", "E", "结茧 / 盘丝", (add, addFormula, addEffect) => {
  addSkill(add, "Elise", "E", "BaseStunDuration", 5, "stun_duration_ms", "人类形态眩晕持续时间（毫秒）", "INTEGER", "当前根BaseStunDuration索引1至5为1.6/1.8/2/2.2/2.4秒，按原始浮点值精确换算整数毫秒。", 10, toMs);
  addField(add, "Elise", "E", "spellCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "mCastTime与spellCastTime均为0.25秒，转换为250毫秒。", 20, 1, toMs);
  addFormula(formula("stun_duration", "结茧眩晕持续", P("stun_duration_ms"), "TotalStunDuration直接读取BaseStunDuration；纯视野和蜘蛛形态盘丝不录。", 10));
  addManaIfReused("elise_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, [
  "纯视野、蜘蛛形态盘丝、被动增强和兵野专用分支排除；没有伤害字段，不添加零伤害。",
], [
  "首个敌人命中与眩晕事件待运行层接线。",
], "只保留当前人类形态本体控制，BaseStunDuration完整技能等级映射。");

define("Elise", "R", "蜘蛛形态", (add, addFormula, addEffect) => {}, [
  "完整变形、蜘蛛普攻附伤/回血和小蜘蛛全链按本轮范围排除。",
], [
  "变形切换和R跨技能引用待后续完整形态处理；0.528699994秒不作为本轮施法参数。",
], "主体实际最高等级4已由保护快照确认，但本轮不录完整变形数值。");

define("Jayce", "P", "海克斯科技电容", (add, addFormula, addEffect) => {}, [
  "武器切换触发的移动速度属于完整变形切换链，本轮不当常驻自身移速。",
], [
  "形态切换事件和30移速/0.75秒效果待后续完整变形处理。",
], "当前根为锤形态；只记录范围边界，不生成P效果。");

define("Jayce", "Q", "苍穹之跃 / 电能震荡", (add, addFormula, addEffect) => {
  addSkill(add, "Jayce", "Q", "BaseDamage", 6, "base_damage", "锤形态物理伤害基础值", "INTEGER", "当前根BaseDamage索引1至6为60/110/160/210/260/310；按保护主体6级读取。", 10);
  addCoefficient(add, "Jayce", "Q", "Damage", "bonus_ad_ratio", "额外攻击力倍率", "Damage树mStat=2、mStatFormula=2、系数1.35，读取来源额外攻击力。", 20);
  addSkill(add, "Jayce", "Q", "Slow", 6, "slow_percent_points", "减速百分数点", "DECIMAL", "Slow原始为负比例，按正文Slow×-100转换为35/40/45/50/55/60百分数点。", 30, value => Math.abs(Number(value)) * 100);
  addFixedData(add, "Jayce", "Q", "SlowDuration", "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "SlowDuration=2秒，转换为2000毫秒。", 40, toMs);
  addField(add, "Jayce", "Q", "spellCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.125秒，转换为125毫秒。", 50, 1, toMs);
  addFormula(formula("physical_damage", "苍穹之跃物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "Damage=基础值+1.35×来源额外攻击力。", 10));
  addManaIfReused("jayce_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, [
  "野怪额外10伤害与炮形态电能震荡弹道排除。",
], [
  "目标命中、减速和锤形态切换资格待运行层接线。",
], "杰斯Q使用保护快照的真实6级，不按普通5级模板截断；Slow为负比例源值转百分数点。");

define("Jayce", "W", "闪电领域 / 超能电荷", (add, addFormula, addEffect) => {
  addSkill(add, "Jayce", "W", "ManaGain", 6, "mana_gain", "锤形态普攻回复法力", "INTEGER", "当前根ManaGain索引1至6为15/17/19/21/23/25；回复资格由攻击事件接线。", 10);
  addSkill(add, "Jayce", "W", "BaseDamage", 6, "base_damage", "闪电领域基础魔法伤害", "INTEGER", "当前根BaseDamage索引1至6为140/200/260/320/380/440；为4秒整段基础值。", 20);
  addFixedData(add, "Jayce", "W", "Duration", "duration_ms", "闪电领域持续时间（毫秒）", "INTEGER", "Duration=4秒；当前正文显示共计伤害，不把整段值乘4。", 30, toMs);
  addCoefficient(add, "Jayce", "W", "Damage", "ap_ratio", "法强倍率", "Damage树mCoefficient=1，当前锤形态W读取来源总法强。", 40);
  addField(add, "Jayce", "W", "spellCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，转换为250毫秒。", 50, 1, toMs);
  addFormula(formula("magic_damage", "闪电领域全程魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "Damage=4秒内共计基础值+1.0×来源总法强；不把共计值误乘持续秒数。", 10));
  addEffect(resourceEffect("mana_gain_on_attack", "锤形态普攻回复法力", "mana_gain", "RESTORE", "回复量明确，具体普攻命中资格由事件层接线。", 30));
  addManaIfReused("jayce_w", addEffect, "复用冻结公共法力参数；仅记录主动基础消耗。");
}, [
  "炮形态超能电荷的攻速强化排除。",
], [
  "锤形态普攻回复和领域持续伤害结算时点待运行层接线；当前根没有冷却字段，不另猜冷却。",
], "保留当前锤形态普攻回蓝和主动4秒共计伤害；不把整段伤害当每秒伤害。");

define("Jayce", "E", "雷霆一击 / 加速之门", (add, addFormula, addEffect) => {
  addSkill(add, "Jayce", "E", "PercHPDamage", 6, "target_max_health_damage_ratio", "目标最大生命伤害比例", "DECIMAL", "当前根PercHPDamage索引1至6为0.08/0.108/0.136/0.164/0.192/0.22。", 10);
  addCoefficient(add, "Jayce", "E", "FlatDamage", "bonus_ad_ratio", "额外攻击力倍率", "FlatDamage树mStat=2、mStatFormula=2、系数1，读取来源额外攻击力；没有固定基础值。", 20, 0);
  addFixedData(add, "Jayce", "E", "KnockbackDistance", "knockback_distance", "击退距离", "INTEGER", "KnockbackDistance=600。", 30);
  addFixedData(add, "Jayce", "E", "KnockbackDuration", "knockback_duration_ms", "击退持续时间（毫秒）", "INTEGER", "KnockbackDuration=0.35秒，转换为350毫秒。", 40, toMs);
  addField(add, "Jayce", "E", "mCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根唯一施法字段mCastTime=0.25秒，转换为250毫秒。", 50, 0, toMs);
  addFormula(formula("magic_damage", "雷霆一击魔法伤害", ADD(MUL(P("bonus_ad_ratio"), bonusAD()), MUL(P("target_max_health_damage_ratio"), targetHP("TOTAL"))), "FlatDamage+PercHPDamage×目标最大生命；没有证据时不补固定基础值0。", 10));
  addManaIfReused("jayce_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, [
  "炮形态加速之门和野怪最大伤害上限排除。",
], [
  "锤形态命中、击退和唯一目标资格待运行层接线。",
], "E的FlatDamage是额外攻击力段，PercHPDamage为技能等级数组；mCastTime独立于炮形态字段。");

define("Jayce", "R", "墨丘利之炮 / 墨丘利之锤", (add, addFormula, addEffect) => {}, [
  "完整武器切换、下一次攻击削减双抗和炮形态第一次攻击额外魔法伤害按范围排除。",
], [
  "变形前后顺序、削减持续与第一次攻击事件待后续完整形态处理。",
], "当前主体实际最高等级1；本轮不因可展开的角色等级树录入已排除形态分支。");

define("Nidalee", "P", "寻觅", (add, addFormula, addEffect) => {
  add(fixedRaw("passive_move_speed_ratio", "草丛或捕猎基础移动速度比例", "DECIMAL", norm(dataAt("Nidalee", "R", "PassivePercentMS") / 100), "当前R的PassivePercentMS=10百分数点；正文的人类被动和捕猎基础移速均读取该值。", 10));
  add(fixedRaw("move_speed_toward_enemy_ratio", "朝敌方英雄移动速度比例", "DECIMAL", norm(dataAt("Nidalee", "R", "PassivePercentMS") * 3 / 100), "当前正文PassivePercentMS×3=30%；不因源字段位于R而丢弃人类被动。", 20));
  add(fixed("toward_enemy_multiplier", "朝敌方英雄移动倍率", "DECIMAL", 3, "当前文本对10%移速写明朝敌方英雄提升至3倍。", 30));
  add(fixedRaw("brush_move_speed_duration_ms", "进入草丛移动速度持续时间（毫秒）", "INTEGER", toMs(2), "当前被动正文写明进入草丛后持续2秒，精确换算为2000毫秒。", 40));
  add(fixedRaw("hunt_duration_ms", "捕猎标记持续时间（毫秒）", "INTEGER", toMs(4), "当前被动正文写明捕猎状态持续4秒，精确换算为4000毫秒。", 50));
  add(fixedRaw("move_speed_cap_ratio", "移动速度叠加上限比例", "DECIMAL", norm(30 / 100), "当前扩展正文写明移动速度可叠加但不能超过30%；上限接线待运行层执行。", 60));
  addEffect(attributeEffect("brush_move_speed", "草丛基础移动速度", "PARAMETER", "passive_move_speed_ratio", "move_speed_percent", "brush_move_speed_duration_ms", "草丛条件下的10%基础分支；与同一草丛支的朝敌方分支互斥，不把10%和30%相加，离开草丛时移除。", 20));
  addEffect(attributeEffect("brush_move_speed_toward_enemy", "草丛朝敌方英雄移动速度", "PARAMETER", "move_speed_toward_enemy_ratio", "move_speed_percent", "brush_move_speed_duration_ms", "草丛朝合格敌方英雄移动时的30%替代分支；不与草丛10%基础分支或捕猎分支叠加，离开草丛或失去方向资格时移除。", 30));
  addEffect(attributeEffect("hunt_move_speed", "捕猎基础移动速度", "PARAMETER", "passive_move_speed_ratio", "move_speed_percent", "hunt_duration_ms", "捕猎条件下的10%基础替代分支；与同一捕猎支的朝敌方分支及草丛支互斥，标记结束时移除。", 40));
  addEffect(attributeEffect("hunt_move_speed_toward_enemy", "朝被捕猎敌人移动速度", "PARAMETER", "move_speed_toward_enemy_ratio", "move_speed_percent", "hunt_duration_ms", "朝被捕猎敌人移动时的30%替代分支；不与捕猎10%基础分支或草丛分支叠加，标记结束或失去同一敌人资格时移除。", 50));
}, [], [
  "草丛进入、Q命中英雄或野怪后的捕猎标记、真实视野和变形切换均待事件层接线；不生成陷阱或视野效果。",
  "草丛与捕猎是互斥状态支：每一支的10%基础移速和朝合格敌方的30%均为条件替代，不在同支相加，也不跨支叠加；最终移速加成封顶30%，离开草丛、捕猎结束或失去朝向资格时须切换/移除。",
], "PassivePercentMS位于R源对象但被人类P当前正文直接消费；保留10%基础值、3倍朝向值、2/4秒和30%上限，四个效果只表达条件分支，互斥和离开条件由事件层接线，比例属性统一使用attribute_flat_add。");

define("Nidalee", "Q", "标枪投掷 / 推倒", (add, addFormula, addEffect) => {
  addSkill(add, "Nidalee", "Q", "SpearMinimumDamage", 5, "minimum_base_damage", "人类形态最小魔法伤害基础值", "INTEGER", "当前根SpearMinimumDamage索引1至5为70/90/110/130/150；索引0=50不作技能1级。", 10);
  addFixedData(add, "Nidalee", "Q", "SpearMinimumAPRatio", "ap_ratio", "标枪法强倍率", "DECIMAL", "HumanMinimumDamage第二分支读取SpearMinimumAPRatio=0.5。", 20);
  addFixedData(add, "Nidalee", "Q", "DamageMulti", "maximum_damage_multiplier", "标枪最大伤害倍率", "DECIMAL", "HumanMaximumDamage将完整HumanMinimumDamage乘DamageMulti=3.25；不是只乘基础段。", 30);
  addFixedData(add, "Nidalee", "Q", "RangeThreshold", "range_threshold", "距离阈值", "INTEGER", "当前根RangeThreshold=525；距离中间曲线语义未证，只保留源值不擅设线性换算。", 40);
  addField(add, "Nidalee", "Q", "castRange", "cast_range", "实际施法距离", "INTEGER", "当前根castRange=1500。", 50);
  addField(add, "Nidalee", "Q", "castRangeDisplayOverride", "display_range", "显示距离", "INTEGER", "当前根castRangeDisplayOverride=1500，与实际距离分开记录。", 60);
  addField(add, "Nidalee", "Q", "missileSpeed", "missile_speed", "标枪弹道速度", "INTEGER", "当前根missileSpeed=1300。", 70);
  addField(add, "Nidalee", "Q", "spellCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确转换为250毫秒。", 80, 1, toMs);
  const minimum = ADD(P("minimum_base_damage"), MUL(P("ap_ratio"), AP()));
  addFormula(formula("minimum_magic_damage", "标枪最小魔法伤害", minimum, "HumanMinimumDamage=基础值+0.5×来源总法强。", 10));
  addFormula(formula("maximum_magic_damage", "标枪最大魔法伤害", MUL(ADD(P("minimum_base_damage"), MUL(P("ap_ratio"), AP())), P("maximum_damage_multiplier")), "HumanMaximumDamage=完整最小伤害式×3.25，距离曲线仅由运行层按已证规则接线。", 20));
  addManaIfReused("nidalee_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。" );
}, [
  "豹形态推倒、陷阱和野怪分支排除；不把tooltipOnly豹形态树当作人类伤害。",
], [
  "标枪飞行距离到中间伤害的曲线、525距离阈值具体语义和命中事件待核；不得把525直接当满伤或默认线性。",
], "当前文本消费HumanMinimumDamage与HumanMaximumDamage；最大式内联完整基础与法强段，保留弹道、显示距离和实际距离。");

define("Nidalee", "W", "丛林伏击 / 猛扑", (add, addFormula, addEffect) => {}, [
  "人类陷阱的持续伤害、持续时间、数量上限及豹形态猛扑均属于独立陷阱或完整变形套装，本轮六类写入保持空。",
], [
  "陷阱生成与触发、视野暴露、豹形态切换和猛扑命中不在当前可独立表达范围。",
], "当前根和文本虽消费陷阱提示树，但范围要求将陷阱与完整变形排除，不创建本体伤害或独立单位接线。");

define("Nidalee", "E", "野性奔腾 / 挥击", (add, addFormula, addEffect) => {
  addSkill(add, "Nidalee", "E", "BaseHeal", 5, "base_heal", "人类形态最小治疗基础值", "INTEGER", "当前根BaseHeal索引1至5为50/75/100/125/150；索引0=25不作技能1级。", 10);
  addFixedData(add, "Nidalee", "E", "MaxHealMult", "max_heal_multiplier_bonus", "生命损失治疗额外倍率", "DECIMAL", "MaxHealing的SumOfSubParts第二项MaxHealMult=1，与固定基准1相加。", 20);
  addFixedData(add, "Nidalee", "E", "MaxHealThreshold", "max_heal_threshold_ratio", "最大治疗生命阈值比例", "DECIMAL", "当前根MaxHealThreshold=0.05；阈值资格和已损生命曲线仍待核。", 30);
  addCoefficient(add, "Nidalee", "E", "TotalHealing", "ap_ratio", "治疗法强倍率", "TotalHealing第二分支mCoefficient=0.35，读取来源总法强。", 40);
  addSkill(add, "Nidalee", "E", "BonusAS", 5, "attack_speed_ratio", "人类形态攻击速度提升比例", "DECIMAL", "当前根BonusAS索引1至5为0.3/0.4/0.5/0.6/0.7；比例属性使用1=100%。", 50);
  addSkill(add, "Nidalee", "E", "ASDuration", 5, "attack_speed_duration_ms", "攻击速度提升持续时间（毫秒）", "INTEGER", "当前根ASDuration索引1至5均为7秒，精确转换为7000毫秒。", 60, toMs);
  addField(add, "Nidalee", "E", "spellCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，精确转换为250毫秒。", 70, 1, toMs);
  addFormula(formula("total_healing", "野性奔腾最小治疗", ADD(P("base_heal"), MUL(P("ap_ratio"), AP())), "TotalHealing=基础治疗+0.35×来源总法强。", 10));
  add(fixed("max_heal_base_multiplier", "最大治疗固定倍率", "DECIMAL", 1, "MaxHealing的SumOfSubParts第一项固定1。", 80));
  addFormula(formula("max_healing_multiplier", "生命损失最大治疗倍率", ADD(P("max_heal_base_multiplier"), P("max_heal_multiplier_bonus")), "MaxHealing的倍率为1+MaxHealMult=2；不引用其他公式。", 20));
  addFormula(formula("maximum_healing", "野性奔腾最大治疗", MUL(ADD(P("base_heal"), MUL(P("ap_ratio"), AP())), ADD(P("max_heal_base_multiplier"), P("max_heal_multiplier_bonus"))), "最大治疗=完整最小治疗式×(1+MaxHealMult)；已损生命中间曲线由运行层按待核规则提供。", 30));
  addEffect(directHealEffect("self_heal", "野性奔腾自身直接治疗", "total_healing", "资格审查确认技能允许自身目标；本轮1V1仅保留奈德丽自身，最大治疗分支仍由已损生命阈值和运行层事件选择。", 20));
  addEffect(attributeEffect("self_attack_speed", "野性奔腾自身攻击速度", "PARAMETER", "attack_speed_ratio", "attack_speed_percent", "attack_speed_duration_ms", "资格审查确认技能允许自身目标；本轮仅记录奈德丽自身攻击速度提升，第三方友方分配排除，持续时间和触发由事件层接线。", 30));
  addManaIfReused("nidalee_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。" );
}, [
  "豹形态挥击和第三友方目标排除；未知已损生命治疗曲线不写成线性公式。",
], [
  "运行层具体如何限制为自身单一目标仍待接线；第三方友方虽有技能事实支持，按本轮1V1范围排除。",
  "最大治疗的已损生命中间曲线、阈值判定和攻速跨形态持续事件仍待运行层核对。",
], "资格审查确认自身目标，本轮只生成自身直接治疗和自身攻击速度效果；当前文本消费TotalHealing与MaxHealing，MaxHealing的1+1倍率和最小治疗完整式均内联。");

define("Nidalee", "R", "美洲狮形态", (add, addFormula, addEffect) => {}, [
  "完整变形、豹形态替换技能和相应攻击链按本轮范围排除；人类P跨R消费的PassivePercentMS已移入P记录。",
], [
  "变形切换及捕猎刷新R的事件顺序待后续完整形态处理；0.528699994秒不作为本轮施法参数。",
], "主体实际最高等级4由保护快照确认；R源值只为P的已证10%移速提供来源，不生成R本体写入。");

define("Shyvana", "P", "龙鳞铁衣", (add, addFormula, addEffect) => {
  addFixedData(add, "Shyvana", "P", "BonusArmor", "bonus_armor_per_stack", "每层额外护甲比例", "DECIMAL", "Calc_Bonus_Armor的BuffCounterByNamedDataValue读取BonusArmor=0.3；每层比例加算。", 10);
  addFixedData(add, "Shyvana", "P", "BonusMagicResist", "bonus_magic_resist_per_stack", "每层额外魔抗比例", "DECIMAL", "Calc_Bonus_MR的BuffCounterByNamedDataValue读取BonusMagicResist=0.3；每层比例加算。", 20);
  addFixedData(add, "Shyvana", "P", "Stacks_Per_Champion", "champion_takedown_stack_gain", "英雄参与击杀获得层数", "INTEGER", "当前根Stacks_Per_Champion=3；事件资格由运行层接线。", 30);
  add(runtime("current_stack_count", "当前龙鳞层数", "INTEGER", "Calc_Bonus_Armor与Calc_Bonus_MR读取被动层数计数；战前实际层数必须由运行层提供，不设默认。", 40));
  addFormula(formula("bonus_armor", "龙鳞铁衣额外护甲", MUL(P("bonus_armor_per_stack"), P("current_stack_count")), "Calc_Bonus_Armor=每层0.3×当前层数。", 10));
  addFormula(formula("bonus_magic_resist", "龙鳞铁衣额外魔抗", MUL(P("bonus_magic_resist_per_stack"), P("current_stack_count")), "Calc_Bonus_MR=每层0.3×当前层数。", 20));
  addEffect(attributeEffect("bonus_armor", "龙鳞铁衣额外护甲", "FORMULA", "bonus_armor", "armor", null, "固定护甲点数加成：每层0.3护甲；不是护甲百分比，层数获取事件由事件层接线。", 20));
  addEffect(attributeEffect("bonus_magic_resist", "龙鳞铁衣额外魔抗", "FORMULA", "bonus_magic_resist", "magic_resistance", null, "固定魔抗点数加成：每层0.3魔抗；不是魔抗百分比，层数获取事件由事件层接线。", 30));
}, [
  "兵线、普通野怪和史诗野怪的层数获取途径不录；不使用旧版小龙双抗说明。",
], [
  "战前当前层数和英雄参与击杀事件由运行层提供；Stacks_Per_Epic_Monster与英雄文本的共同语义不额外推断。",
], "两个当前计算树均为被动层数计数乘每层DataValue；比例结果使用attribute_flat_add，当前层数保持无默认整数输入。");

define("Shyvana", "Q", "焚焰打击", (add, addFormula, addEffect) => {
  add(fixedRaw("max_health_damage_ratio", "普攻附加目标最大生命比例", "DECIMAL", norm(dataAt("Shyvana", "Q", "Max_Health_Damage")), "Calc_Max_Health_Damage第一分支Max_Health_Damage=0.01。", 10));
  add(fixedRaw("max_health_bonus_ad_ratio", "普攻附加额外攻击力比例", "DECIMAL", norm(dataAt("Shyvana", "Q", "Max_Health_AD_Ratio")), "Calc_Max_Health_Damage第二分支Max_Health_AD_Ratio=0.00011，读取来源额外攻击力。", 20));
  addSkill(add, "Shyvana", "Q", "Base_Damage", 5, "active_base_damage", "强化攻击基础物理伤害", "INTEGER", "当前根Base_Damage索引1至5为10/15/20/25/30；计算树键BASE_DAMAGE按源DataValue绑定。", 30);
  addFixedData(add, "Shyvana", "Q", "Damage_AD_Ratio", "active_total_ad_ratio", "强化攻击总攻击力倍率", "DECIMAL", "Calc_Damage第二分支Damage_AD_Ratio=1.1，当前正文为总攻击力段。", 40);
  addCoefficient(add, "Shyvana", "Q", "Calc_Damage", "active_ap_ratio", "强化攻击法强倍率", "Calc_Damage第三分支mCoefficient=0.3，读取来源总法强。", 50, 2);
  addFixedData(add, "Shyvana", "Q", "Cooldown_Reduction", "cooldown_reduction_ms", "普攻缩短Q冷却时间（毫秒）", "INTEGER", "Cooldown_Reduction=0.5秒，精确转换为500毫秒。", 60, toMs);
  addSkill(add, "Shyvana", "Q", "EnhanceDuration", 5, "enhance_duration_ms", "强化窗口（毫秒）", "INTEGER", "当前根EnhanceDuration索引1至5均为6秒，转换为6000毫秒。", 70, toMs);
  addSkill(add, "Shyvana", "Q", "RecastDuration", 5, "recast_duration_ms", "再施窗口（毫秒）", "INTEGER", "当前根RecastDuration索引1至5均为4秒，转换为4000毫秒。", 80, toMs);
  addSkill(add, "Shyvana", "Q", "LockoutDuration", 5, "lockout_duration_ms", "再次攻击锁定时间（毫秒）", "INTEGER", "当前根LockoutDuration索引1至5均为1.5秒，转换为1500毫秒。", 90, toMs);
  addSkill(add, "Shyvana", "Q", "Bonus_Attack_Range", 5, "bonus_attack_range", "强化攻击额外距离", "INTEGER", "当前根Bonus_Attack_Range索引1至5均为50。", 100);
  addField(add, "Shyvana", "Q", "spellCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0；精确记录为0毫秒，不表示两次攻击同时完成。", 110, 1, toMs);
  addFormula(formula("passive_max_health_magic_damage", "焚焰打击普攻附加魔法伤害", MUL(ADD(P("max_health_damage_ratio"), MUL(P("max_health_bonus_ad_ratio"), bonusAD())), targetHP("TOTAL")), "Calc_Max_Health_Damage=[0.01+0.00011×来源额外攻击力]×目标最大生命。", 10));
  addFormula(formula("active_physical_damage", "焚焰打击强化攻击物理伤害", ADD(ADD(P("active_base_damage"), MUL(P("active_total_ad_ratio"), totalAD())), MUL(P("active_ap_ratio"), AP())), "Calc_Damage=基础值+1.1×来源总攻击力+0.3×来源总法强。", 20));
  addEffect(cooldownEffect("reduce_q_cooldown", "普攻命中后缩短自身Q冷却", "cooldown_reduction_ms", ["shyvana_q"], "仅记录0.5秒冷却缩短量；普攻命中、第一或第二次同敌目标及扣减时点由事件层接线。", 20));
}, [
  "龙形态第三击真实伤害放大、额外敌人锥形分配和兵野专用分支排除。",
], [
  "普攻后触发、同一敌人第一与第二次命中、强化窗口和锁定时序待运行层接线；spellCastTime=0不折算为同时攻击。",
], "保留当前人类根的普攻附加魔法段、强化攻击完整三段物理公式和0.5秒自身Q冷却缩短；Calc_Damage的BASE_DAMAGE按Base_Damage源值绑定。");

define("Shyvana", "W", "烈火圣盾", (add, addFormula, addEffect) => {
  addSkill(add, "Shyvana", "W", "Duration", 5, "duration_ms", "护盾与移动速度持续时间（毫秒）", "INTEGER", "当前根Duration索引1至5均为2.5秒，转换为2500毫秒。", 10, toMs);
  addFixedData(add, "Shyvana", "W", "Radius", "explosion_radius", "结束爆炸半径", "INTEGER", "当前根Radius=350；与护盾附近目标检查半径分开。", 20);
  addFixedData(add, "Shyvana", "W", "Shield_Radius", "shield_radius", "护盾目标检查半径", "INTEGER", "当前根Shield_Radius=600。", 30);
  addSkill(add, "Shyvana", "W", "Shield", 5, "shield_base", "基础护盾值", "INTEGER", "当前根Shield索引1至5为60/80/100/120/140；索引0=40不作技能1级。", 40);
  addFixedData(add, "Shyvana", "W", "ShieldMaxHealth", "bonus_health_ratio", "额外生命护盾比例", "DECIMAL", "Calc_Shield第二分支ShieldMaxHealth=0.12，读取来源额外生命。", 50);
  add(fixedRaw("nearby_enemy_bonus_ratio", "附近合格敌人护盾加成比例", "DECIMAL", mNumber("Shyvana", "W", "Calc_Shield_Per_Nearby_Champion"), "附近敌人修改树mMultiplier=0.3，作用于完整Calc_Shield。", 60));
  add(runtime("nearby_enemy_count", "护盾范围内合格敌人数", "INTEGER", "只允许当前唯一敌人场景的0或1；运行层必须提供实际数量，不默认填0。", 70));
  addSkill(add, "Shyvana", "W", "BaseMoveSpeed", 5, "move_speed_ratio", "自身移动速度提升比例", "DECIMAL", "当前根BaseMoveSpeed索引1至5均为0.25；比例属性使用1=100%。", 80);
  addSkill(add, "Shyvana", "W", "MoveSpeedAmpTowardsEnemies", 5, "move_speed_toward_multiplier", "朝敌方英雄移动倍率", "DECIMAL", "当前根MoveSpeedAmpTowardsEnemies索引1至5均为1.75。", 90);
  addSkill(add, "Shyvana", "W", "BaseDamage", 5, "explosion_base_damage", "结束爆炸基础魔法伤害", "INTEGER", "当前根BaseDamage索引1至5为80/100/120/140/160；索引0=60不作技能1级。", 100);
  addCoefficient(add, "Shyvana", "W", "Damage", "explosion_ap_ratio", "结束爆炸法强倍率", "Damage第二分支mCoefficient=0.65，读取来源总法强。", 110);
  addFormula(formula("shield_amount", "烈火圣盾基础护盾", ADD(P("shield_base"), MUL(P("bonus_health_ratio"), sourceHPBonus())), "Calc_Shield=基础护盾+0.12×来源额外生命。", 10));
  addFormula(formula("nearby_shield_bonus", "附近敌人护盾加成量", MUL(ADD(P("shield_base"), MUL(P("bonus_health_ratio"), sourceHPBonus())), P("nearby_enemy_bonus_ratio")), "附近敌人修改树=完整Calc_Shield×0.3；不把每个敌人直接展开为无限目标。", 20));
  addFormula(formula("shield_total", "烈火圣盾最终护盾", ADD(ADD(P("shield_base"), MUL(P("bonus_health_ratio"), sourceHPBonus())), MUL(MUL(ADD(P("shield_base"), MUL(P("bonus_health_ratio"), sourceHPBonus())), P("nearby_enemy_bonus_ratio")), P("nearby_enemy_count"))), "最终护盾=完整基础护盾+[完整基础护盾×0.3×合格敌人数]，敌人数只核对0或1。", 30));
  addFormula(formula("toward_move_speed_ratio", "朝敌方英雄移动速度比例", MUL(P("move_speed_ratio"), P("move_speed_toward_multiplier")), "MoveSpeedTowardsEnemies=0.25×1.75=0.4375；以内联二元式表达，不引用其他公式。", 40));
  addFormula(formula("explosion_magic_damage", "烈火圣盾结束爆炸魔法伤害", ADD(P("explosion_base_damage"), MUL(P("explosion_ap_ratio"), AP())), "Damage=结束爆炸基础值+0.65×来源总法强。", 50));
  addEffect(shieldEffect("shield", "烈火圣盾最终护盾", "shield_total", "duration_ms", "护盾按当前唯一敌人数计算；护盾生成与结束/破盾/再施爆炸事件由事件层接线。", 20));
  addEffect(attributeEffect("move_speed", "烈火圣盾自身移动速度", "PARAMETER", "move_speed_ratio", "move_speed_percent", "duration_ms", "烈火圣盾的25%基础状态分支；与朝合格敌方的43.75%完整替代分支互斥，不把两者相加，施放和移除事件由事件层接线。", 30));
  addEffect(attributeEffect("move_speed_toward_enemy", "烈火圣盾朝敌方移动速度", "FORMULA", "toward_move_speed_ratio", "move_speed_percent", "duration_ms", "朝唯一合格敌方移动时的43.75%完整替代分支；与25%基础状态互斥，失去方向资格或持续时间结束时切换/移除。", 40));
}, [
  "龙形态治疗和额外变形爆炸链排除；未消费的旧Heal_Min/Heal_Max插值树不录。",
], [
  "护盾范围内合格敌人数必须由运行层提供0或1；护盾生成、附近目标资格、移动方向和结束事件待接线。",
  "朝敌方移动的43.75%与25%基础移动速度是完整状态替代，不能叠加为68.75%；各技能等级均按源数组核对，唯一敌人资格与状态切换由运行层接线。",
], "护盾基础、附近敌人完整盾30%修改、朝敌移动1.75倍和爆炸伤害均从当前根独立准备；Radius350与Shield_Radius600分开，移动速度两分支互斥且比例属性使用attribute_flat_add。");

define("Shyvana", "E", "爆炎吐息", (add, addFormula, addEffect) => {
  addSkill(add, "Shyvana", "E", "BaseDamage", 5, "base_damage", "普通形态火球基础魔法伤害", "INTEGER", "当前根BaseDamage索引1至5为50/65/80/95/110；索引0=35不作技能1级。", 10);
  addSkill(add, "Shyvana", "E", "DamageAPRatio", 5, "ap_ratio", "普通形态火球法强倍率", "DECIMAL", "当前根DamageAPRatio索引1至5为0.6/0.65/0.7/0.75/0.8。", 20);
  addFixedData(add, "Shyvana", "E", "MaxHealthDamage", "target_max_health_damage_ratio", "目标最大生命伤害比例", "DECIMAL", "Calc_Max_Health_Damage读取MaxHealthDamage=0.05；普通形态保留。", 30);
  addSkill(add, "Shyvana", "E", "SlowAmount", 5, "slow_ratio", "普通形态减速比例", "DECIMAL", "当前根SlowAmount索引1至5均为0.3；比例属性和显示30%分开。", 40);
  addSkill(add, "Shyvana", "E", "SlowDuration", 5, "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "当前根SlowDuration索引1至5均为2秒，转换为2000毫秒。", 50, toMs);
  addField(add, "Shyvana", "E", "spellCastTime", "cast_time_ms", "施法时间（毫秒）", "INTEGER", "当前根spellCastTime=0.25秒，转换为250毫秒。", 60, 1, toMs);
  addFormula(formula("damage", "爆炎吐息火球基础魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "Damage=基础值+DamageAPRatio×来源总法强。", 10));
  addFormula(formula("max_health_damage", "爆炎吐息目标最大生命伤害", MUL(P("target_max_health_damage_ratio"), targetHP("TOTAL")), "Calc_Max_Health_Damage=0.05×目标最大生命。", 20));
  addFormula(formula("magic_damage", "爆炎吐息普通形态完整魔法伤害", ADD(ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), MUL(P("target_max_health_damage_ratio"), targetHP("TOTAL"))), "普通形态总伤害=火球基础+法强段+目标最大生命5%；不接龙形态放大或地面轨迹。", 30));
}, [
  "龙形态放大、穿透、地面轨迹每秒伤害、重复爆炸和兵野专用最大伤害上限排除；普通形态不生成地面持续伤害。",
], [
  "普通火球命中、减速目标和最终伤害结算事件待运行层接线。",
], "当前普通形态文本消费Damage和Calc_Max_Health_Damage；三公式均以内联二元树表达，保留减速比例、持续时间和精确施法时间。");

define("Shyvana", "R", "魔龙降世", (add, addFormula, addEffect) => {}, [
  "完整变形、飞跃喷火、怒气消耗与龙形态替换链按本轮范围排除。",
], [
  "mCastTime=0.25秒与spellCastTime=0冲突不任选；龙怒100和0.75秒逃跑事件待后续完整形态处理。",
], "主体实际最高等级3由保护快照确认；不能把未变形R伪装为独立喷火技能。");

for (const [skillKey, conclusion] of [["elise_w", qualificationBySkill.elise_w], ["nidalee_e", qualificationBySkill.nidalee_e]]) {
  defs[skillKey].proofs.push({
    type: "qualification-review",
    reviewId: qualificationReview.reviewId,
    revision: qualificationReview.revision,
    status: qualificationReview.status,
    file: "hero47-qualification-review/资格审查.json",
    fileSha256: shaFile(qualificationFile),
    recordingDecision: conclusion.recordingDecision,
    inference: conclusion.inference,
  });
}

const order = [
  "elise_p", "elise_q", "elise_w", "elise_e", "elise_r",
  "jayce_p", "jayce_q", "jayce_w", "jayce_e", "jayce_r",
  "nidalee_p", "nidalee_q", "nidalee_w", "nidalee_e", "nidalee_r",
  "shyvana_p", "shyvana_q", "shyvana_w", "shyvana_e", "shyvana_r",
];
assert(order.length === 20 && order.every(key => defs[key]), "20槽候选顺序不完整");

const reusedPublicParameters = reuseList.map(item => {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const hit = snapshotByRoute.get(route);
  assert(hit?.status === 200, `公共参数保护缺失：${route}`);
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

const sourceFiles = [];
for (const item of inputVersion.sourceFiles || []) {
  const file = path.join(INPUT, item.path.replaceAll("/", path.sep));
  assert(fs.existsSync(file), `输入源文件不存在：${item.path}`);
  const actual = shaFile(file);
  assert(actual === item.sha256, `输入源文件散列不一致：${item.path}`);
  sourceFiles.push({ path: `hero47-root-entry-20260910/${item.path}`, role: item.role, sha256: actual, byteSize: fs.statSync(file).size });
}
for (const [relative, file, role] of [
  ["来源绑定与当前文本.json", bindingFile, "当前绑定与原始对象索引"],
  ["输入版本.json", versionFile, "输入版本"],
  ["主负责人范围与核对要求.md", rangeFile, "主负责人范围要求"],
  ["主负责人源值核对说明.md", sourceNoteFile, "主负责人源值核对"],
  ["README.md", inputReadmeFile, "输入说明"],
]) sourceFiles.push({ path: `hero47-root-entry-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });
for (const [relative, file, role] of [
  ["Cursor来源复核结论.md", cursorConclusionFile, "Cursor来源复核结论"],
  ["主负责人执行审计.json", cursorAuditFile, "Cursor执行审计元数据"],
]) sourceFiles.push({ path: `hero47-cursor-review-run-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });
for (const [relative, file, role] of [
  ["资格审查.json", qualificationFile, "技能资格审查"],
  ["来源摘录.md", qualificationExcerptFile, "资格审查来源摘录"],
  ["README.md", qualificationReadmeFile, "资格审查说明"],
  ["文件散列.json", qualificationManifestFile, "资格审查散列清单"],
]) sourceFiles.push({ path: `hero47-qualification-review/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });

const hashes = {
  sourceBindingSha256: shaFile(bindingFile),
  sourceRangeSha256: shaFile(rangeFile),
  sourceAuditSha256: shaFile(sourceNoteFile),
  cursorConclusionSha256: shaFile(cursorConclusionFile),
  cursorAuditSha256: shaFile(cursorAuditFile),
  protectionSnapshotSha256: shaFile(protectionFile),
  publicReuseSha256: shaFile(reuseFile),
  inputVersionSha256: shaFile(versionFile),
  attributeNarrowSha256: shaFile(attributeFile),
  payloadSampleSha256: shaFile(payloadFile),
  qualificationReviewSha256: shaFile(qualificationFile),
  qualificationExcerptSha256: shaFile(qualificationExcerptFile),
  qualificationReadmeSha256: shaFile(qualificationReadmeFile),
  qualificationManifestSha256: shaFile(qualificationManifestFile),
};

const generatedAt = new Date().toISOString();
const protectedCompositionCount = (protection.requests || []).filter(item => /\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(item.route)).length;
const candidate = {
  meta: {
    generatedAt,
    batch: BATCH,
    revision: REVISION,
    status: "候选已生成，等待主负责人审查；未调用业务接口",
    gameId: "lol",
    apiBase: API_BASE,
    sourceVersion: SOURCE_VERSION,
    sourcePolicy: "固定客户端16.17、官方16.17.1、当前根绑定正文和原始计算树；明确值入候选，未知曲线、资格、时序和实际属性用无默认运行输入或待接线说明。",
    scope: "伊莉丝、杰斯、奈德丽、希瓦娜20个技能槽；当前根人类或锤形态；保留本体伤害、控制、同敌重复、自身属性与资源，跳过完整变形、替换套装、独立召唤物、陷阱和兵野分支。伊莉丝W按资格审查的一次性本体技能伤害载体记录，奈德丽E本轮只记录自身目标。",
    ...hashes,
    inputGETs: inputVersion.GETs,
    currentGETs: inputVersion.GETs,
    reusedPublicParameterCount: inputVersion.reusedParameters,
    apiCalls: 0,
    apiWrites: 0,
    businessWrites: 0,
    noBusinessWrites: true,
    tokenStored: false,
    candidateSha256: null,
    sourceReview: {
      conclusionFile: ".agents/artifacts/hero47-cursor-review-run-20260910/Cursor来源复核结论.md",
      conclusionSha256: hashes.cursorConclusionSha256,
      auditFile: ".agents/artifacts/hero47-cursor-review-run-20260910/主负责人执行审计.json",
      auditSha256: hashes.cursorAuditSha256,
      verdict: "READY",
      runId: cursorAudit.runId,
      requestId: cursorAudit.requestId,
      events: cursorAudit.events,
      uniqueTools: cursorAudit.uniqueTools,
      toolNames: clone(cursorAudit.toolNames || {}),
      inputsChecked: cursorAudit.inputsChecked,
      apiWrites: cursorAudit.apiWrites,
      gitDelta: Array.isArray(cursorAudit.gitDelta) ? cursorAudit.gitDelta.length : Number(cursorAudit.gitDelta || 0),
      reviewedPlanRev: cursorAudit.reviewedPlanRev,
      note: "主负责人逐槽核对说明和实际Cursor复核作为当前消费优先依据；本候选未调用业务接口。",
    },
    qualificationReview: {
      reviewId: qualificationReview.reviewId,
      revision: qualificationReview.revision,
      status: qualificationReview.status,
      conclusionFile: "hero47-qualification-review/资格审查.json",
      conclusionSha256: hashes.qualificationReviewSha256,
      excerptFile: "hero47-qualification-review/来源摘录.md",
      excerptSha256: hashes.qualificationExcerptSha256,
      manifestFile: "hero47-qualification-review/文件散列.json",
      manifestSha256: hashes.qualificationManifestSha256,
      eliseW: "一次施放、一次爆炸的本体技能伤害载体；不建立独立召唤物实体；静态结构推断，事件仍待运行层接线。",
      nidaleeE: "技能事实允许自身或单一友方；本轮1V1仅保留自身治疗和攻击速度，第三方友方排除。",
      apiCalls: qualificationReview.scope.apiCalls,
      apiWrites: qualificationReview.scope.apiWrites,
      databaseCalls: qualificationReview.scope.databaseCalls,
      browserCalls: qualificationReview.scope.browserCalls,
      gitWrites: qualificationReview.scope.gitWrites,
    },
    inputPackage: ".agents/artifacts/hero47-root-entry-20260910",
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
    protectedCurrentCompositionLists: protectedCompositionCount,
  },
  apiWrites: 0,
  sourceFiles,
  sourceNotes: {
    fixedClient: "输入包/参考资料/客户端原文/*.json.gz，客户端16.17完整对象",
    fixedOfficial: "输入包/参考资料/官方中文与官方英文，官方16.17.1",
    currentText: "输入包/来源绑定与当前文本.json的当前根绑定正文",
    attributes: "输入包/参考资料/属性默认与边界.json只用于窄映射，未知运行属性保持无默认输入",
    payload: "输入包/参考资料/接口载荷样例.json只作结构参考，不复制数值",
    qualification: "hero47-qualification-review/资格审查.json及来源摘录；只补伊莉丝W一次性技能载体和奈德丽E自身目标资格，不替代固定版本数值或运行层验证",
  },
  protectedObjects: {
    snapshot: "输入包/参考资料/当前20槽保护快照.json",
    snapshotSha256: hashes.protectionSnapshotSha256,
    inputGETs: protection.GETs,
    requestCount: protection.requests.length,
    routes: protectedRouteHashes,
    publicReuse: clone(reusedPublicParameters),
    note: "193条只读保护覆盖字典、角色、关系、20个技能主体及组成列表；21项公共参数只读复用。",
  },
  revision: REVISION,
};
for (const key of order) {
  for (const [kind, countKey] of Object.entries({
    parameters: "newParameters", formulas: "newFormulas", effects: "newEffects",
    processes: "newProcesses", internalStates: "newInternalStates", triggerRules: "newTriggerRules",
  })) candidate.counts[countKey] += defs[key].write[kind].length;
}
candidate.counts.newTotal = Object.entries(candidate.counts)
  .filter(([key]) => key.startsWith("new") && key !== "newTotal")
  .reduce((sum, [, value]) => sum + value, 0);
candidate.counts.plannedTotalIncludingReused = candidate.counts.newTotal + candidate.counts.reusedPublicParameters;

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
  cursorAuditSha256: hashes.cursorAuditSha256,
  qualificationReviewSha256: hashes.qualificationReviewSha256,
  qualificationExcerptSha256: hashes.qualificationExcerptSha256,
  qualificationManifestSha256: hashes.qualificationManifestSha256,
  sourceReviewVerdict: "READY",
  qualificationReviewVerdict: qualificationReview.status,
  fixedVersions: SOURCE_VERSION,
  globalScope: {
    included: ["当前根本体伤害与控制", "同一敌人的连续命中", "自身属性与基础资源", "当前消费的匿名或tooltipOnly计算树", "唯一敌方英雄场景"],
    excluded: ["完整变形与替换技能套装", "独立召唤物和陷阱", "兵野与建筑专用分支", "额外敌人分配", "纯视野", "未证实际插值或距离曲线"],
    unknownPolicy: "未知曲线、实际命中次数、未证属性和事件时序用无默认运行输入或待接线说明，不用0占位；伊莉丝W载体分类为资格审查的静态结构推断，奈德丽E第三方友方按本轮范围排除。",
  },
  skills: Object.fromEntries(order.map(key => [key, {
    maxLevel: defs[key].maxLevel,
    recordableParameters: defs[key].write.parameters.map(item => item.parameterKey),
    recordableFormulas: defs[key].write.formulas.map(item => item.formulaKey),
    recordableEffects: defs[key].write.effects.map(item => item.effectKey),
    excluded: clone(defs[key].excluded),
    pending: clone(defs[key].pending),
    currentSubjectProtected: defs[key].protectedExisting.subject,
  }])),
  noApiCalls: true,
  apiWrites: 0,
};

const requests = [];
for (const key of order) {
  for (const [kind, idField, apiName] of [
    ["parameters", "parameterKey", "parameters"], ["formulas", "formulaKey", "formulas"], ["effects", "effectKey", "effects"],
    ["processes", "processKey", "processes"], ["internalStates", "stateKey", "internal-states"], ["triggerRules", "ruleKey", "trigger-rules"],
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
assert(requests.length === candidate.counts.newTotal, "POST计划数量与候选数量不符");
const candidateBytes = jsonBytes(candidate);
const candidateSha256 = sha256(candidateBytes);
candidate.meta.candidateSha256 = candidateSha256;
const scopeBytes = jsonBytes(scope);
const scopeSha256 = sha256(scopeBytes);
const plan = {
  generatedAt,
  status: "仅写入意图，未调用业务接口",
  batch: BATCH,
  revision: REVISION,
  apiBase: API_BASE,
  sourceVersion: SOURCE_VERSION,
  candidateSha256,
  sourceBindingSha256: hashes.sourceBindingSha256,
  sourceRangeSha256: scopeSha256,
  inputSourceRangeSha256: hashes.sourceRangeSha256,
  sourceAuditSha256: hashes.sourceAuditSha256,
  cursorConclusionSha256: hashes.cursorConclusionSha256,
  cursorAuditSha256: hashes.cursorAuditSha256,
  qualificationReviewSha256: hashes.qualificationReviewSha256,
  qualificationExcerptSha256: hashes.qualificationExcerptSha256,
  qualificationManifestSha256: hashes.qualificationManifestSha256,
  qualificationReviewVerdict: qualificationReview.status,
  protectionSnapshotSha256: hashes.protectionSnapshotSha256,
  publicReuseSha256: hashes.publicReuseSha256,
  requestCount: requests.length,
  counts: clone(candidate.counts),
  reusedPublicParameters: clone(reusedPublicParameters),
  protectedRoutes: protectedRouteHashes,
  protectedSummary: {
    inputGETs: protection.GETs,
    inputRequestCount: protection.requests.length,
    currentCompositionLists: protectedCompositionCount,
    note: "写入前逐条只读保护；本计划不覆盖已有主体和组成。",
  },
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
  qualificationReviewSha256: hashes.qualificationReviewSha256,
  qualificationExcerptSha256: hashes.qualificationExcerptSha256,
  qualificationManifestSha256: hashes.qualificationManifestSha256,
  qualificationReviewVerdict: qualificationReview.status,
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
  qualificationReviewVerdict: qualificationReview.status,
  qualificationReviewId: qualificationReview.reviewId,
  counts: clone(candidate.counts),
  requestCount: requests.length,
  sourceMath: "独立数学核算.mjs",
  sourceMathStatus: "脚本已生成，待执行",
  cursorVerdict: "READY",
  cursorRunId: cursorAudit.runId,
  cursorEvents: cursorAudit.events,
  cursorUniqueTools: cursorAudit.uniqueTools,
  cursorInputsChecked: cursorAudit.inputsChecked,
  apiCalls: 0,
  apiWrites: 0,
  businessWrites: 0,
  noBusinessWrites: true,
};
const freezeNotice = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  candidateSha256,
  planSha256,
  scopeSha256,
  sourceValuesSha256,
  qualificationReviewSha256: hashes.qualificationReviewSha256,
  qualificationExcerptSha256: hashes.qualificationExcerptSha256,
  qualificationManifestSha256: hashes.qualificationManifestSha256,
  qualificationReviewVerdict: qualificationReview.status,
  qualificationReviewId: qualificationReview.reviewId,
  counts: clone(candidate.counts),
  requestCount: requests.length,
  inputGETs: inputVersion.GETs,
  reusedPublicParameters: reusedPublicParameters.length,
  cursorVerdict: "READY",
  cursorRunId: cursorAudit.runId,
  cursorEvents: cursorAudit.events,
  cursorUniqueTools: cursorAudit.uniqueTools,
  cursorInputsChecked: cursorAudit.inputsChecked,
  apiCalls: 0,
  apiWrites: 0,
  businessWrites: 0,
  status: "冻结候选，等待主负责人审查；未调用业务接口",
};
const freezeBytes = jsonBytes(freezeNotice);
const generatorBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const fileEntries = {
  "完整候选.json": { sha256: candidateSha256, byteSize: candidateBytes.length },
  "请求计划.json": { sha256: planSha256, byteSize: planBytes.length },
  "来源与范围.json": { sha256: scopeSha256, byteSize: scopeBytes.length },
  "来源值摘要.json": { sha256: sourceValuesSha256, byteSize: sourceValuesBytes.length },
  "候选版本.json": { sha256: sha256(jsonBytes(version)), byteSize: jsonBytes(version).length },
  "生成候选.mjs": { sha256: sha256(generatorBytes), byteSize: generatorBytes.length },
  "来源冻结通知.json": { sha256: sha256(freezeBytes), byteSize: freezeBytes.length },
};
const hashesSummary = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "候选输出文件散列；未调用业务接口",
  sourceFiles: clone(sourceFiles),
  outputFiles: fileEntries,
  sourceHashes: hashes,
  qualificationReview: {
    reviewId: qualificationReview.reviewId,
    revision: qualificationReview.revision,
    verdict: qualificationReview.status,
    conclusionSha256: hashes.qualificationReviewSha256,
    excerptSha256: hashes.qualificationExcerptSha256,
    manifestSha256: hashes.qualificationManifestSha256,
  },
  cursorReview: {
    verdict: "READY",
    runId: cursorAudit.runId,
    events: cursorAudit.events,
    uniqueTools: cursorAudit.uniqueTools,
    inputsChecked: cursorAudit.inputsChecked,
  },
  noApiCalls: true,
  apiWrites: 0,
};
const readme = [
  "# 第四十七批候选",
  "",
  "本目录保存伊莉丝、杰斯、奈德丽、希瓦娜20个技能槽的候选组成。来源固定客户端16.17、官方16.17.1、当前根绑定正文和原始计算树；实际Cursor复核为READY，主负责人审计只读。",
  "",
  "候选仅生成写入意图，未调用接口。193条只读输入保护20个技能主体和组成列表，21项公共参数只读复用；当前消费的计算树、源数组索引和等级边界均在来源摘要中保留。",
  "",
  "范围保留当前根的人类或锤形态本体伤害、控制、同一敌人的重复命中、自身属性与基础资源；完整变形、替换技能套装、独立召唤物、陷阱、兵野专用分支和额外敌人分配排除。奈德丽P跨R读取的10%移动速度已保留；资格审查确认奈德丽E本轮只录自身治疗和攻速，伊莉丝W按一次爆炸本体技能载体保留。",
  "",
  "公式全部为二元操作且不引用其他公式。比例属性使用attribute_flat_add；明确时间精确换算为整数毫秒；未知曲线、实际命中次数、属性和事件时序使用无默认运行输入或待接线说明，不以0占位。伊莉丝W的载体分类是资格审查依据冻结对象结构作出的有界推断，仍不等于运行层事件验证。",
  "",
  "独立数学核算从冻结输入的DataValues、计算树和当前文本独立求期望值，逐公式提供至少两个场景、缺输入拒绝、完整等级、源数组索引、整数毫秒、二元树、效果最终倍率和比例属性乘区检查。",
  "",
  "本目录与交叉试录目录均为静态候选证据，不表示真实数据库、运行时、页面或战斗已完成。",
  "",
].join("\n");

const outputs = {
  "完整候选.json": candidateBytes,
  "请求计划.json": planBytes,
  "来源与范围.json": scopeBytes,
  "来源值摘要.json": sourceValuesBytes,
  "候选版本.json": jsonBytes(version),
  "来源冻结通知.json": freezeBytes,
  "来源哈希汇总.json": jsonBytes(hashesSummary),
  "README.md": Buffer.from(readme, "utf8"),
};
for (const [name, bytes] of Object.entries(outputs)) {
  writeBytes(path.join(ROOT, name), bytes);
  writeBytes(path.join(DURABLE, name), bytes);
}

const manifest = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  files: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, { sha256: sha256(bytes), byteSize: bytes.length }])),
  sourceHashes: hashes,
  cursorReview: {
    verdict: "READY",
    runId: cursorAudit.runId,
    events: cursorAudit.events,
    uniqueTools: cursorAudit.uniqueTools,
    inputsChecked: cursorAudit.inputsChecked,
  },
  noApiCalls: true,
  apiWrites: 0,
};
writeJson(path.join(ROOT, "文件散列.json"), manifest);
writeJson(path.join(DURABLE, "文件散列.json"), manifest);

console.log(JSON.stringify({
  candidateSha256,
  planSha256,
  scopeSha256,
  sourceValuesSha256,
  counts: candidate.counts,
  requestCount: requests.length,
  protectedCompositionCount,
  cursor: { verdict: "READY", runId: cursorAudit.runId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, inputsChecked: cursorAudit.inputsChecked },
  root: ROOT,
  durable: DURABLE,
  apiCalls: 0,
  apiWrites: 0,
}, null, 2));
