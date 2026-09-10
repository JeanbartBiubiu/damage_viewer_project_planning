import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero46-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十六批");
const CURSOR = path.resolve(ROOT, "..", "hero46-cursor-review-run-20260910");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "英雄机制第四十六批";
const REVISION = "hero46-source-v1-luna-candidate";
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
const round = (value, digits = 9) => Number(Number(value).toFixed(digits));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const finite = (value, label) => {
  assert(typeof value === "number" && Number.isFinite(value), "固定参数必须是有限数字：" + label + "/" + value);
  return round(value);
};
const toMs = (seconds, label = "time") => {
  const value = Number(seconds) * 1000;
  const rounded = Math.round(value);
  assert(Number.isFinite(value) && rounded >= 0 && Math.abs(value - rounded) < 0.1, "时间不是可解释的整数毫秒：" + label + "/" + seconds);
  return rounded;
};
const ratio = value => round(Number(value) / 100);

const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const versionFile = path.join(INPUT, "输入版本.json");
const rangeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const auditFile = path.join(INPUT, "主负责人源值核对说明.md");
const inputReadmeFile = path.join(INPUT, "README.md");
const qualificationFile = path.join(INPUT, "资格补证.md");
const supplementFile = path.join(INPUT, "彗九种技法来源补充.json");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const cursorReviewFile = path.join(CURSOR, "Cursor来源复核结论.md");
const cursorAuditFile = path.join(CURSOR, "主负责人执行审计.json");
const cursorSummaryFile = path.join(CURSOR, "summary.json");
const cursorPreflightFile = path.join(CURSOR, "preflight.md");
const cursorEventsFile = path.join(CURSOR, "events.jsonl");

const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const supplement = readJson(supplementFile);
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
const reuseSet = new Set(reuseList.map(item => item.skillKey + "/" + item.parameterKey));
const supplementByObject = new Map(supplement.skills.map(item => [item.object.ObjectName, item]));
const techniqueGroups = {
  Q: ["HweiQQ", "HweiQW", "HweiQE"],
  W: ["HweiWQ", "HweiWW", "HweiWE"],
  E: ["HweiEQ", "HweiEW", "HweiEE"],
};
const publicKey = (heroId, slot, parameterKey) => reuseSet.has(heroId.toLowerCase() + "_" + slot.toLowerCase() + "/" + parameterKey);
const sourceReviewAudit = readJson(cursorAuditFile);
assert(sourceReviewAudit.readonlyAuditPassed === true, "Cursor只读审计未通过");
assert(sourceReviewAudit.events === 3134 && sourceReviewAudit.uniqueTools === 63 && sourceReviewAudit.inputsChecked === 26, "Cursor46审计数字不符");
assert(sourceReviewAudit.apiWrites === 0 && Array.isArray(sourceReviewAudit.gitDelta) && sourceReviewAudit.gitDelta.length === 0, "Cursor46审计存在写入或Git变化");
const sourceReview = {
  conclusionFile: ".agents/artifacts/hero46-cursor-review-run-20260910/Cursor来源复核结论.md",
  conclusionSha256: shaFile(cursorReviewFile),
  auditFile: ".agents/artifacts/hero46-cursor-review-run-20260910/主负责人执行审计.json",
  auditSha256: shaFile(cursorAuditFile),
  summaryFile: ".agents/artifacts/hero46-cursor-review-run-20260910/summary.json",
  summarySha256: shaFile(cursorSummaryFile),
  preflightFile: ".agents/artifacts/hero46-cursor-review-run-20260910/preflight.md",
  eventsFile: ".agents/artifacts/hero46-cursor-review-run-20260910/events.jsonl",
  eventsSha256: shaFile(cursorEventsFile),
  verdict: "READY",
  reviewedPlanRev: sourceReviewAudit.reviewedPlanRev,
  runId: sourceReviewAudit.runId,
  requestId: sourceReviewAudit.requestId,
  events: sourceReviewAudit.events,
  uniqueTools: sourceReviewAudit.uniqueTools,
  toolNames: clone(sourceReviewAudit.toolNames),
  frozenInputs: sourceReviewAudit.inputsChecked,
  apiWrites: sourceReviewAudit.apiWrites,
  gitChanges: sourceReviewAudit.gitDelta.length,
  note: "Cursor仅复核来源；非阻塞项按主负责人逐槽说明处理，公共参数只复用不覆盖。",
};

const sourceFiles = {};
for (const item of inputVersion.sourceFiles || []) {
  const file = path.join(INPUT, item.path.replaceAll("/", path.sep));
  assert(fs.existsSync(file), "输入源文件不存在：" + item.path);
  const actual = shaFile(file);
  assert(actual === item.sha256, "输入源文件散列不一致：" + item.path);
  sourceFiles[item.path.replaceAll("\\", "/")] = { sha256: actual, byteSize: fs.statSync(file).size };
}
for (const [label, file] of [
  ["来源绑定与当前文本.json", bindingFile],
  ["输入版本.json", versionFile],
  ["主负责人范围与核对要求.md", rangeFile],
  ["主负责人源值核对说明.md", auditFile],
  ["README.md", inputReadmeFile],
  ["资格补证.md", qualificationFile],
  ["彗九种技法来源补充.json", supplementFile],
  ["参考资料/当前20槽保护快照.json", protectionFile],
  ["参考资料/公共参数复用清单.json", reuseFile],
  ["参考资料/属性默认与边界.json", attributeFile],
  ["参考资料/接口载荷样例.json", payloadFile],
  ["Cursor来源复核结论.md", cursorReviewFile],
  ["Cursor主负责人执行审计.json", cursorAuditFile],
  ["Cursor-summary.json", cursorSummaryFile],
  ["Cursor-preflight.md", cursorPreflightFile],
  ["Cursor-events.jsonl", cursorEventsFile],
]) {
  sourceFiles[label] = { sha256: shaFile(file), byteSize: fs.statSync(file).size };
}

const skillAt = (heroId, slot) => {
  const value = sourceSkills[heroId] && sourceSkills[heroId][slot];
  assert(value, "缺少源技能：" + heroId + "/" + slot);
  return value;
};
const spell = (heroId, slot) => skillAt(heroId, slot).object.mSpell;
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot).DataValues || []).find(item => item.name === name);
  assert(row && Array.isArray(row.values), "缺少DataValue：" + heroId + "/" + slot + "/" + name);
  return row.values;
};
const dataAt = (heroId, slot, name, index = 1) => {
  const value = dataRow(heroId, slot, name)[index];
  assert(value !== undefined, "DataValue索引不存在：" + heroId + "/" + slot + "/" + name + "/" + index);
  return finite(value, heroId + "/" + slot + "/" + name + "/" + index);
};
const levels = (heroId, slot, name, count, start = 1, transform = value => value) => Object.fromEntries(
  Array.from({ length: count }, (_, index) => {
    const value = transform(dataAt(heroId, slot, name, start + index));
    return [String(index + 1), finite(value, heroId + "/" + slot + "/" + name + "/level" + (index + 1))];
  }),
);
const fieldValues = (heroId, slot, name) => {
  const value = spell(heroId, slot)[name];
  const values = Array.isArray(value) ? value : value && Array.isArray(value.values) ? value.values : null;
  assert(values, "缺少数组字段：" + heroId + "/" + slot + "/" + name);
  return values;
};
const fieldLevels = (heroId, slot, name, count, start = 1, transform = value => value) => Object.fromEntries(
  Array.from({ length: count }, (_, index) => {
    const value = transform(finite(fieldValues(heroId, slot, name)[start + index], heroId + "/" + slot + "/" + name + "/" + (start + index)));
    return [String(index + 1), finite(value, heroId + "/" + slot + "/" + name + "/level" + (index + 1))];
  }),
);
const calc = (heroId, slot, name) => {
  const value = (spell(heroId, slot).mSpellCalculations || {})[name];
  assert(value, "缺少计算树：" + heroId + "/" + slot + "/" + name);
  return value;
};
const part = (heroId, slot, calcName, index = 0) => {
  const value = (calc(heroId, slot, calcName).mFormulaParts || [])[index];
  assert(value, "缺少计算树分支：" + heroId + "/" + slot + "/" + calcName + "/" + index);
  return value;
};
const calcCoefficient = (heroId, slot, calcName, index = 1) => {
  const value = part(heroId, slot, calcName, index).mCoefficient;
  return finite(value, heroId + "/" + slot + "/" + calcName + "/mCoefficient");
};
const rawTime = (heroId, slot, field) => {
  const value = spell(heroId, slot)[field];
  assert(typeof value === "number" && Number.isFinite(value), "缺少单值时间字段：" + heroId + "/" + slot + "/" + field);
  return toMs(value, heroId + "/" + slot + "/" + field);
};
const officialFor = (heroId, slot, english = false) => {
  const file = path.join(INPUT, "参考资料", english ? "官方英文" : "官方中文", heroId + ".json");
  const root = readJson(file).data[heroId];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};

const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);
const sourceTotalAD = () => A("SOURCE", "attack_damage", "TOTAL");
const sourceBonusAD = () => A("SOURCE", "attack_damage", "BONUS");
const sourceAP = () => A("SOURCE", "ability_power", "TOTAL");
const sourceHP = () => A("SOURCE", "hp", "TOTAL");
const targetHP = () => A("TARGET", "hp", "TOTAL");
const fixed = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "FIXED", fixedValue: finite(fixedValue, parameterKey), levelValues: null, description, sortOrder,
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
const valueRule = (kind, key, fixedMultiplier = 1) => ({
  value: { kind, [kind === "PARAMETER" ? "parameterKey" : "formulaKey"]: key },
  fixedMultiplier: finite(fixedMultiplier, "effect.fixedMultiplier"),
  fixedMinValue: 0,
  fixedMaxValue: null,
});
const lifecycle = (durationKey, instanceScope = "SOURCE") => ({
  durationValue: durationKey ? { kind: "PARAMETER", parameterKey: durationKey } : null,
  maxStacksValue: { kind: "FIXED", value: 1 },
  applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope,
  reapplicationStackMode: "KEEP",
  reapplicationDurationMode: durationKey ? "REFRESH_ALL" : null,
  expiryMode: durationKey ? "ALL_AT_ONCE" : "EXPLICIT_ONLY",
  periodicIntervalValue: null,
  firstPeriodicExecution: null,
});
const resultLifecycle = (mode = "REPLACE") => ({
  moment: "PERSISTENT",
  valueReadMode: "APPLICATION_SNAPSHOT",
  stackValueMode: "SHARED",
  reapplicationValueMode: mode,
  periodicExecutionMode: null,
});
const attrEffect = (effectKey, name, description, attributeKey, valueKind, valueKey, durationKey, order = 20) => ({
  effectKey,
  name,
  description,
  sortOrder: order,
  lifecycle: lifecycle(durationKey),
  results: [{
    resultKey: "attribute",
    name,
    resultType: "ATTRIBUTE_CHANGE",
    target: "SOURCE",
    description: "只定义自身属性变化，触发条件由事件层接线。",
    sortOrder: 10,
    lifecycleBehavior: resultLifecycle(),
    spellShieldBlockScope: null,
    valueRule: valueRule(valueKind, valueKey),
    detail: { attributeKey, operation: "INCREASE", modifierZoneKey: "attribute_flat_add" },
  }],
});
const shieldEffect = (effectKey, name, description, formulaKey, durationKey, order = 20) => ({
  effectKey,
  name,
  description,
  sortOrder: order,
  lifecycle: lifecycle(durationKey),
  results: [{
    resultKey: "shield",
    name,
    resultType: "NORMAL_SHIELD",
    target: "SOURCE",
    description: "普通护盾，触发和移除事件由事件层接线。",
    sortOrder: 10,
    lifecycleBehavior: resultLifecycle(),
    spellShieldBlockScope: null,
    valueRule: valueRule("FORMULA", formulaKey),
    detail: { absorbedDamageTypeKey: null, decayMode: "NONE" },
  }],
});
const resourceEffect = (effectKey, name, attributeKey, valueKind, valueKey, operation, order = 900) => ({
  effectKey,
  name,
  description: "仅记录自身资源变化；实际时点由事件层接线。",
  sortOrder: order,
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
    valueRule: valueRule(valueKind, valueKey),
    detail: { attributeKey, operation },
  }],
});
const resetCooldownEffect = (effectKey, name, affectedSkillKeys, order = 30) => ({
  effectKey,
  name,
  description: "仅记录来源明确的指定技能冷却重置；命中资格和实际时点由事件层接线。",
  sortOrder: order,
  lifecycle: null,
  results: [{
    resultKey: "reset_cooldown",
    name,
    resultType: "COOLDOWN_CHANGE",
    target: "SOURCE",
    description: "重置指定技能，不携带数值规则。",
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: null,
    detail: {
      affectedSkillScope: { mode: "SKILLS", skillKeys: affectedSkillKeys, skillCategoryKeys: [] },
      operation: "RESET",
    },
  }],
});

const defs = {};
const define = (heroId, slot, displayName, maxLevel, build, excluded = [], pending = [], proofNote = "") => {
  const skillKey = heroId.toLowerCase() + "_" + slot.toLowerCase();
  const write = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  const add = item => {
    if (!item) return;
    if (reuseSet.has(skillKey + "/" + item.parameterKey)) return;
    assert(!write.parameters.some(value => value.parameterKey === item.parameterKey), "重复参数：" + skillKey + "/" + item.parameterKey);
    write.parameters.push(item);
  };
  const addFormula = item => {
    assert(!write.formulas.some(value => value.formulaKey === item.formulaKey), "重复公式：" + skillKey + "/" + item.formulaKey);
    write.formulas.push(item);
  };
  const addEffect = item => {
    assert(!write.effects.some(value => value.effectKey === item.effectKey), "重复效果：" + skillKey + "/" + item.effectKey);
    write.effects.push(item);
  };
  build(add, addFormula, addEffect, write);
  const source = sourceFor(heroId, slot);
  defs[skillKey] = {
    skillKey,
    name: heroes[heroId].name + "·" + displayName,
    maxLevel,
    source,
    write,
    protectedExisting: {
      subject: subjectByRoute.has("/skills/" + skillKey),
      compositionLists: true,
      protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json",
    },
    excluded,
    pending,
    proofs: [
      { type: "root-bound-source", path: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot },
      { type: "fixed-source-version", client: binding.clientVersion, official: binding.officialVersion, build: heroes[heroId].source.client.contentVersion },
      { type: "cursor-source-review", runId: sourceReview.runId, verdict: sourceReview.verdict, events: sourceReview.events, uniqueTools: sourceReview.uniqueTools },
    ],
    proofNote,
    currentSubject: clone(subjectByRoute.get("/skills/" + skillKey) || null),
  };
};
const levelFrom = (heroId, slot, sourceName, maxLevel, key, name, type, description, order, start = 1, transform = value => value) =>
  publicKey(heroId, slot, key) ? null : skill(key, name, type, levels(heroId, slot, sourceName, maxLevel, start, transform), description, order);
const levelFieldFrom = (heroId, slot, sourceName, maxLevel, key, name, type, description, order, start = 1, transform = value => value) =>
  publicKey(heroId, slot, key) ? null : skill(key, name, type, fieldLevels(heroId, slot, sourceName, maxLevel, start, transform), description, order);
const fixedFrom = (heroId, slot, sourceName, key, name, type, description, order, index = 1, transform = value => value) =>
  publicKey(heroId, slot, key) ? null : fixed(key, name, type, transform(dataAt(heroId, slot, sourceName, index)), description, order);
const fixedTime = (heroId, slot, field, key, name, description, order) =>
  publicKey(heroId, slot, key) ? null : fixed(key, name, "INTEGER", rawTime(heroId, slot, field), description, order);

const techniqueSource = objectName => {
  const item = supplementByObject.get(objectName);
  assert(item, "缺少彗技法补充源：" + objectName);
  const sp = item.object.mSpell;
  return {
    objectName,
    path: item.path,
    objectPath: item.object.objectPath,
    mScriptName: item.object.mScriptName,
    currentTexts: clone(item.currentTexts),
    raw: {
      dataValues: Object.fromEntries((sp.DataValues || []).map(row => [row.name, row.values ? clone(row.values) : null])),
      calculations: clone(sp.mSpellCalculations || {}),
      fields: Object.fromEntries(["mCastTime", "spellCastTime", "spellTotalTime", "cooldownTime", "Cooldown", "mana", "manaValues", "mAffectsTypeFlags", "mSpellTags", "castRange", "mSpellCooldownOrSealedQueueThreshold"].map(key => [key, sp[key] === undefined ? null : clone(sp[key])])),
    },
    clientFile: "输入包/彗九种技法来源补充.json",
    clientCompressedSha256: supplement.clientCompressedSha256,
  };
};
const techniqueDataAt = (objectName, name, index = 1) => {
  const item = supplementByObject.get(objectName);
  assert(item, "缺少彗技法补充源：" + objectName);
  const row = (item.object.mSpell.DataValues || []).find(value => value.name === name);
  assert(row && Array.isArray(row.values), "彗技法补充值缺失：" + objectName + "/" + name);
  const value = row.values[index];
  assert(Number.isFinite(value), "彗技法补充值不是数字：" + objectName + "/" + name + "/" + index);
  return value;
};
const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const sourceMeta = skillAt(heroId, slot);
  const rawSpell = sourceMeta.object.mSpell;
  const source = {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    slot,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath,
    spellPath: sourceMeta.binding || sourceMeta.clientPath,
    bindingAvailable: hero.source.skills.find(item => item.slot === slot)?.bindingAvailable ?? true,
    clientFile: "参考资料/客户端原文/" + heroId + ".json.gz",
    clientSha256: hero.source.client.sha256,
    clientCompressedSha256: shaFile(path.join(INPUT, "参考资料", "客户端原文", heroId + ".json.gz")),
    clientBuild: hero.source.client.contentVersion,
    officialZhFile: "参考资料/官方中文/" + heroId + ".json",
    officialZhSha256: shaFile(path.join(INPUT, "参考资料", "官方中文", heroId + ".json")),
    officialEnFile: "参考资料/官方英文/" + heroId + ".json",
    officialEnSha256: shaFile(path.join(INPUT, "参考资料", "官方英文", heroId + ".json")),
    currentBoundText: clone(sourceMeta.currentTexts),
    raw: {
      dataValues: Object.fromEntries((rawSpell.DataValues || []).map(row => [row.name, row.values ? clone(row.values) : null])),
      calculations: clone(rawSpell.mSpellCalculations || {}),
      fields: Object.fromEntries(["mCastTime", "spellCastTime", "spellTotalTime", "mChannelDuration", "cooldownTime", "Cooldown", "mana", "manaValues", "mMaxAmmo", "mAmmoRechargeTime", "mDoesNotConsumeMana", "mDoesNotConsumeCooldown", "mTargetingTypeData", "mClientData"].map(key => [key, rawSpell[key] === undefined ? null : clone(rawSpell[key])])),
    },
    officialEvidence: { zh: clone(officialFor(heroId, slot)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot + "/currentTexts",
  };
  if (heroId === "Hwei" && techniqueGroups[slot]) {
    source.techniqueSources = techniqueGroups[slot].map(techniqueSource);
    source.techniquePolicy = "三种技法保存在既有Q/W/E组内，不新建主体；菜单选择不生成独立消耗或冷却。";
  }
  return source;
};

// 卑尔维斯
define("Belveth", "P", "溶烛化紫", 1, (add, addFormula, addEffect) => {
  add(fixedFrom("Belveth", "P", "ChampionStacks", "champion_kill_stacks", "英雄参与击杀获得层数", "INTEGER", "当前英雄击杀源值为2层；兵野和其他模式层数排除。", 10));
  add(runtime("stack_count", "当前溶烛化紫层数", "INTEGER", "战前永久层数和当前战斗层数由运行状态提供，不设默认。", 20));
  add(runtime("actual_stack_attack_speed_ratio", "当前每层实际攻击速度比例", "DECIMAL", "AttackSpeedPerStack含角色等级断点但中间曲线未证；提供实际每层比例，1表示100%，不设默认。", 30));
  add(fixed("stack_ratio_level1", "1级每层攻击速度起点", "DECIMAL", dataAt("Belveth", "P", "ASPerStackLevel1Value"), "哈希断点结构的1级每层起点，比例单位。", 40));
  add(fixed("stack_ratio_initial_per_level", "初始每级每层攻击速度增量", "DECIMAL", dataAt("Belveth", "P", "ASPerStackInitialBonusPerLevel"), "断点前逐级增量；不据此补齐完整曲线。", 50));
  add(fixed("stack_ratio_after_level6", "6级后每级每层攻击速度增量", "DECIMAL", dataAt("Belveth", "P", "ASPerStackLevel6BonusPerLevel"), "6级断点后的源值；不据此补齐完整曲线。", 60));
  add(fixed("stack_ratio_after_level11", "11级后每级每层攻击速度增量", "DECIMAL", dataAt("Belveth", "P", "ASPerStackLevel11BonusPerLevel"), "11级断点后的源值；不据此补齐完整曲线。", 70));
  add(runtime("actual_temporary_attack_speed_ratio", "当前幽灵临时攻击速度比例", "DECIMAL", "SheenSpeedPerStack虽起止皆0.2但带角色等级乘数语义，提供实际比例，不设默认。", 80));
  add(fixed("temporary_attack_speed_endpoint_ratio", "临时攻击速度端点比例", "DECIMAL", calc("Belveth", "P", "SheenSpeedPerStack").mFormulaParts[0].mStartValue, "客户端临时攻速计算起止均为0.2；不当作全等级实值。", 90));
  add(fixed("temporary_attack_speed_duration_ms", "临时攻击速度持续（毫秒）", "INTEGER", toMs(dataAt("Belveth", "P", "SheenDuration"), "Belveth/P/SheenDuration"), "正文明确3秒。", 100));
  addFormula(formula("temporary_attack_speed_bonus", "溶烛化紫临时攻击速度", P("actual_temporary_attack_speed_ratio"), "保留实际角色等级乘数后的临时攻速比例。", 10));
  addFormula(formula("permanent_attack_speed_bonus", "溶烛化紫永久攻击速度", MUL(P("stack_count"), P("actual_stack_attack_speed_ratio")), "永久攻速=当前层数×当前每层实际比例。", 20));
  addEffect(attrEffect("temporary_attack_speed", "溶烛化紫临时攻速", "自身临时攻速比例增量；幽灵触发事件待接线。", "bonus_attack_speed_percent", "FORMULA", "temporary_attack_speed_bonus", "temporary_attack_speed_duration_ms", 30));
  addEffect(attrEffect("permanent_attack_speed", "溶烛化紫永久攻速", "自身层数攻速比例增量；层数状态由事件层接线。", "bonus_attack_speed_percent", "FORMULA", "permanent_attack_speed_bonus", null, 40));
}, [
  { item: "大型小兵和野怪层数、ARAM/Brawl模式层数", reason: "纯兵野或模式专用收益。" },
  { item: "SheenNumberOfAttacks=2", reason: "当前正文不消费两次攻击节奏。" },
], [
  { item: "每层攻速中间曲线", reason: "仅有1级、6级、11级断点，使用无默认实际输入。" },
  { item: "临时攻速角色等级乘数语义", reason: "mScaleByStatProgressionMultiplier语义待运行层核对。" },
], "保留英雄击杀层数、永久层数和3秒自身临时攻速；不把断点端点误写成完整等级曲线。");

define("Belveth", "Q", "虚空激流", 5, (add, addFormula) => {
  add(levelFrom("Belveth", "Q", "Damage", 5, "damage_base", "单敌基础物理伤害", "INTEGER", "DataValues.Damage索引1至5：12/14/16/18/20。", 10));
  add(fixedFrom("Belveth", "Q", "ADRatio", "total_ad_ratio", "总攻击力倍率", "DECIMAL", "BaseDamage的mStat=2，来源总攻击力倍率1.05。", 20));
  add(levelFrom("Belveth", "Q", "PerSideCooldown", 5, "per_side_cooldown_ms", "单方向基础冷却（毫秒）", "INTEGER", "每个方向独立冷却16/15/14/13/12秒，按整数毫秒保存。", 30, 1, value => toMs(value, "Belveth/Q/PerSideCooldown")));
  add(fixedFrom("Belveth", "Q", "PerSideCDAttackSpeedMultiplier", "attack_speed_to_haste_ratio", "每百分数点攻速换算技能急速", "DECIMAL", "每1%攻击速度换算0.2技能急速；这是换算系数，不是属性增量。", 40));
  add(runtime("actual_attack_speed_percent_points", "当前实际攻击速度百分数点", "DECIMAL", "方向冷却缩短实际读取的攻速口径未在根绑定中独立证实，按百分数点提供，不设默认。", 50));
  add(fixed("dash_distance", "普通冲刺距离", "INTEGER", dataAt("Belveth", "Q", "DashDistance"), "普通形态400距离。", 60));
  add(fixed("base_dash_speed", "基础冲刺速度", "INTEGER", dataAt("Belveth", "Q", "BaseDashSpeed"), "普通形态850速度。", 70));
  add(levelFieldFrom("Belveth", "Q", "Cooldown", 5, "overall_cooldown_ms", "整体施放冷却（毫秒）", "INTEGER", "整体Cooldown为4/3.25/2.5/1.75/1秒，仅记录以区别方向冷却，不能替代方向冷却。", 80, 1, value => toMs(value, "Belveth/Q/Cooldown")));
  addFormula(formula("dash_physical_damage", "虚空激流单敌物理伤害", ADD(P("damage_base"), MUL(P("total_ad_ratio"), sourceTotalAD())), "基础伤害+1.05×来源总攻击力。", 10));
  addFormula(formula("direction_cooldown_haste", "虚空激流方向冷却攻速换算", MUL(P("attack_speed_to_haste_ratio"), P("actual_attack_speed_percent_points")), "每百分数点攻速提供0.2技能急速；实际缩短公式待事件层接线。", 20));
}, [
  { item: "穿墙625/1500速度、野怪额外伤害、未消费吸血字段", reason: "真实形态或兵野专用分支。" },
], [
  { item: "攻速缩短实际作用公式", reason: "只记录已知换算系数和无默认攻速输入。" },
], "方向独立冷却、整体冷却、单敌伤害和普通冲刺边界分开保存。");

define("Belveth", "W", "上觐沉渊", 5, (add, addFormula, addEffect) => {
  add(levelFrom("Belveth", "W", "BaseDamage", 5, "damage_base", "基础魔法伤害", "INTEGER", "DataValues.BaseDamage索引1至5：80/140/200/260/320。", 10));
  add(runtime("stat_formula_2_value", "当前mStat省略且formula2的实际属性值", "DECIMAL", "W计算树省略mStat、保留mStatFormula=2；法强窄证不能将其改成攻击力或总法强，运行层提供实际值，不设默认。", 20));
  add(fixedFrom("Belveth", "W", "SlowPercent", "slow_ratio", "减速比例", "DECIMAL", "30%减速按比例0.3保存。", 30));
  add(fixedFrom("Belveth", "W", "SlowDuration", "slow_duration_ms", "减速持续（毫秒）", "INTEGER", "正文明确2秒。", 40, 1, value => toMs(value, "Belveth/W/SlowDuration")));
  add(levelFrom("Belveth", "W", "Duration", 5, "knockup_duration_ms", "击飞持续（毫秒）", "INTEGER", "击飞0.6/0.7/0.8/0.9/1秒。", 50, 1, value => toMs(value, "Belveth/W/Duration")));
  add(fixedTime("Belveth", "W", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "来源mCastTime=0.5秒；只记录施法字段，不代替命中时点。", 60));
  add(fixed("damage_coefficient", "mStatFormula2伤害系数", "DECIMAL", calcCoefficient("Belveth", "W", "Damage", 1), "Damage树保留系数1.5。", 70));
  addFormula(formula("magic_damage", "上觐沉渊单敌魔法伤害", ADD(P("damage_base"), MUL(P("damage_coefficient"), P("stat_formula_2_value"))), "80至320+1.5×实际mStat/formula2属性值；不猜属性枚举。", 10));
  addEffect(resetCooldownEffect("refresh_q_direction", "命中英雄刷新对应方向虚空激流", ["belveth_q"], 20));
}, [
  { item: "穿墙、野怪伤害和其他形态字段", reason: "真实形态或兵野专用。" },
], [
  { item: "mStat省略属性和命中方向", reason: "保留系数与无默认实际属性，刷新事件待接线。" },
], "不把mStatFormula=2误读为1.5额外攻击力或1.5总法强；命中英雄刷新Q作为重置效果意图保留。");

define("Belveth", "E", "搠面皇锋", 5, (add, addFormula, addEffect) => {
  add(fixedFrom("Belveth", "E", "TotalDuration", "channel_duration_ms", "引导持续（毫秒）", "INTEGER", "正文明确1.5秒引导。", 10, 1, value => toMs(value, "Belveth/E/TotalDuration")));
  add(levelFrom("Belveth", "E", "DamagePerHit", 5, "damage_per_hit_base", "每击基础物理伤害", "INTEGER", "每击10/12/14/16/18。", 20));
  add(fixedFrom("Belveth", "E", "OnHitRatio", "onhit_effect_ratio_min", "攻击特效效能下限", "DECIMAL", "来源正文下限12%，比例0.12。", 30));
  add(fixed("onhit_effect_ratio_max_multiplier", "攻击特效效能上限相对倍率", "DECIMAL", 2, "正文明确12%至24%，以2倍下限表示上限。", 40));
  add(levelFrom("Belveth", "E", "NumberOfStrikes", 5, "base_strike_count", "基础攻击次数", "INTEGER", "基础次数6；技能等级源值保持6。", 50));
  add(fixedFrom("Belveth", "E", "DRPercent", "damage_reduction_ratio", "伤害减免比例", "DECIMAL", "减伤20%至60%，比例单位。", 60));
  add(levelFrom("Belveth", "E", "BonusLifeSteal", 5, "life_steal_ratio", "额外生命偷取比例", "DECIMAL", "生命偷取20%/25%/30%/35%/40%，比例单位。", 70));
  add(fixed("attack_speed_strike_ratio", "攻速转攻击次数系数", "DECIMAL", calc("Belveth", "E", "TotalStrikes").mFormulaParts[1].mPart2.mCoefficient, "TotalStrikes树中0.4×mStat4/formula2的系数。", 80));
  add(runtime("actual_attack_speed_stat_formula_2", "当前mStat4/formula2实际攻速值", "DECIMAL", "攻击次数读取mStat4且formula2的属性口径未证明，运行层提供实际值，不设默认。", 90));
  add(runtime("actual_strike_count", "当前实际整数攻击次数", "INTEGER", "选择器、取整和时点未知，运行层直接提供实际整数次数，不以6+2.4替代。", 100));
  addFormula(formula("damage_per_strike", "搠面皇锋每击物理伤害", ADD(P("damage_per_hit_base"), MUL(P("onhit_damage_ad_ratio"), sourceTotalAD())), "每击=基础值+0.12×来源总攻击力；缺失生命段另由事件层提供。", 110));
  add(fixedFrom("Belveth", "E", "OnHitRatio", "onhit_damage_ad_ratio", "每击总攻击力倍率", "DECIMAL", "DamagePerStrike树mStat=2系数0.12。", 115));
  addFormula(formula("maximum_damage_per_strike", "搠面皇锋每击最高物理伤害", MUL(P("max_damage_multiplier"), ADD(P("damage_per_hit_base"), MUL(P("onhit_damage_ad_ratio"), sourceTotalAD()))), "MaxDamagePerStrikeTooltip仅为每击整体×2，不猜中间缺血曲线。", 120));
  add(fixed("max_damage_multiplier", "每击最高伤害倍率", "DECIMAL", calc("Belveth", "E", "MaxDamagePerStrikeTooltip").mMultiplier.mNumber, "tooltipOnly树根乘数2。", 125));
  addFormula(formula("source_counted_strikes", "搠面皇锋来源攻击次数", ADD(P("base_strike_count"), MUL(P("base_strike_count"), MUL(P("attack_speed_strike_ratio"), P("actual_attack_speed_stat_formula_2")))), "来源树=6+6×0.4×实际mStat4/formula2；不替代实际整数次数。", 130));
  addFormula(formula("actual_strikes", "搠面皇锋当前实际攻击次数", P("actual_strike_count"), "运行层提供取整后的实际次数。", 140));
  addFormula(formula("total_lifesteal_ratio", "搠面皇锋自身生命偷取比例", P("life_steal_ratio"), "自身生命偷取比例20%至40%。", 150));
  addEffect(attrEffect("self_life_steal", "搠面皇锋自身生命偷取", "自身生命偷取比例；攻击次数和命中时点待接线。", "life_steal_percent", "FORMULA", "total_lifesteal_ratio", "channel_duration_ms", 20));
}, [
  { item: "野怪伤害倍率和野怪目标", reason: "纯野怪分支。" },
], [
  { item: "mStat4/formula2、取整、缺失生命中间曲线和触发时点", reason: "用无默认实际输入保留源树边界。" },
], "引导、减伤、生命偷取、单击伤害、最高×2和实际整数次数分别保存；不编造中间次数。");

define("Belveth", "R", "万载豪筵", 3, (add, addFormula) => {
  add(levelFrom("Belveth", "R", "OnHitDamage", 3, "passive_onhit_base", "普通形态R被动基础真实伤害", "INTEGER", "普通形态被动按技能等级保存2/4/6；不接真正形态主动爆炸。", 10));
  add(fixed("bonus_ad_ratio", "普通形态R被动额外攻击力倍率", "DECIMAL", calcCoefficient("Belveth", "R", "FinalOnHitDamage", 1), "FinalOnHitDamage树mStat=2/formula2，主负责人说明按额外攻击力0.03消费。", 20));
  add(runtime("qualified_hit_count", "当前合资格触发次数", "INTEGER", "叠层、触发频率和同一敌人资格由运行事件提供，不设默认。", 30));
  add(fixedFrom("Belveth", "R", "RPassiveStackDuration", "passive_stack_duration_ms", "普通形态被动层数持续（毫秒）", "INTEGER", "原始5秒字段仅记录，不解释为每次普攻或隔次普攻。", 40, 1, value => toMs(value, "Belveth/R/RPassiveStackDuration")));
  addFormula(formula("passive_true_damage", "万载豪筵普通形态被动真实伤害", ADD(P("passive_onhit_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "普通形态R被动=2/4/6+0.03×来源额外攻击力。", 50));
}, [
  { item: "真正形态、虚空珊瑚、吞噬、虚空鱼和主动爆炸", reason: "完整真正形态及依赖其变形的主动链按范围跳过。" },
], [
  { item: "被动叠层和触发频率", reason: "只保留每次合资格的源值与无默认事件输入。" },
], "R普通形态被动单次真实伤害保留；主动变形链作为范围排除依据保存。");

// 彗
define("Hwei", "P", "落款", 1, (add, addFormula) => {
  add(fixed("mark_duration_ms", "落款标记持续（毫秒）", "INTEGER", toMs(dataAt("Hwei", "P", "Duration"), "Hwei/P/Duration"), "正文明确4秒；不使用旧InkTimeout=25000毫秒替代。", 10));
  add(runtime("actual_mark_damage_base", "当前角色等级落款基础伤害", "DECIMAL", "TotalDamage为角色等级40至285的插值，算法未知，运行层提供当前实际基础项，不设默认。", 20));
  add(fixed("mark_damage_base_lower", "落款基础伤害下界", "INTEGER", calc("Hwei", "P", "TotalDamage").mFormulaParts[0].mStartValue, "角色等级插值起点。", 30));
  add(fixed("mark_damage_base_upper", "落款基础伤害上界", "INTEGER", calc("Hwei", "P", "TotalDamage").mFormulaParts[0].mEndValue, "角色等级插值终点。", 40));
  add(fixed("mark_ap_ratio", "落款法强倍率", "DECIMAL", calcCoefficient("Hwei", "P", "TotalDamage", 1), "TotalDamage法强系数0.35。", 50));
  add(fixed("per_skill_target_trigger_count", "每技能每目标触发次数", "INTEGER", 1, "官方正文明确每个技能对每个目标只触发一次。", 60));
  add(runtime("actual_slow_stack_decay_ratio", "当前技能减速递减有效比例", "DECIMAL", "不同技能减速的递减组合规则未证，运行层提供实际有效比例，不设默认。", 70));
  addFormula(formula("mark_magic_damage", "落款单次魔法伤害", ADD(P("actual_mark_damage_base"), MUL(P("mark_ap_ratio"), sourceAP())), "落款伤害=当前角色等级基础项+0.35×来源总法强。", 80));
}, [
  { item: "InkTimeout=25000", reason: "旧字段不替代正文4秒标记。" },
], [
  { item: "角色等级插值中间值和减速递减规则", reason: "保留端点并使用无默认实际输入。" },
], "保留4秒标记、每技能每目标一次和40至285+0.35法强；不把旧25秒字段当现行标记。");

define("Hwei", "Q", "主题：灾", 5, (add, addFormula) => {
  add(levelFrom("Hwei", "Q", "Tooltip_QQBaseDamage", 5, "qq_damage_base", "没骨火基础魔法伤害", "INTEGER", "没骨火基础50/80/110/140/170。", 10));
  add(levelFrom("Hwei", "Q", "Tooltip_QQBonusDamage", 5, "qq_target_hp_percent_points", "没骨火目标最大生命百分数点", "DECIMAL", "源值3/4/5/6/7百分数点，1表示100%的比例转换另列。", 20));
  add(fixed("percent_point_ratio", "百分数点转比例", "DECIMAL", 0.01, "3百分数点转换为0.03比例；只用于计算，不改变源值摘要。", 30));
  add(fixed("qq_ap_ratio", "没骨火法强倍率", "DECIMAL", calcCoefficient("Hwei", "Q", "Tooltip_QQDamage", 1), "Tooltip_QQDamage系数0.8。", 40));
  add(levelFrom("Hwei", "Q", "Tooltip_QWBaseDamage", 5, "qw_damage_base", "攒聚雷基础魔法伤害", "INTEGER", "攒聚雷基础60/85/110/135/160。", 50));
  add(fixed("qw_ap_ratio", "攒聚雷法强倍率", "DECIMAL", calcCoefficient("Hwei", "Q", "Tooltip_QWDamage", 1), "Tooltip_QWDamage系数0.3。", 60));
  add(levelFrom("Hwei", "Q", "Tooltip_QWBonusDamageMult", 5, "qw_condition_max_multiplier", "攒聚雷条件最高整段倍率", "DECIMAL", "孤立或定身低血条件最高整段倍率按源级别取2/2.375/2.75/3.125/3.5。", 70));
  add(runtime("qw_actual_condition_damage", "当前攒聚雷条件伤害", "DECIMAL", "低血曲线和条件选择未证，运行层提供当前实际伤害，不设默认。", 80));
  add(fixed("qw_delay_ms", "攒聚雷延迟（毫秒）", "INTEGER", 1000, "独立施法延迟1秒；当前根对象未提供同名DataValue，按主负责人固定源值说明保存。", 90));
  add(fixed("qw_cast_time_ms", "攒聚雷施法时间（毫秒）", "INTEGER", 500, "根说明明确攒聚雷独立施法500毫秒。", 100));
  add(levelFrom("Hwei", "Q", "Tooltip_QEBaseDamage", 5, "qe_burst_base", "连皴山爆裂基础魔法伤害", "INTEGER", "连皴山爆裂20/35/50/65/80。", 110));
  add(levelFrom("Hwei", "Q", "Tooltip_QEBaseDPS", 5, "qe_damage_per_second_base", "连皴山每秒基础魔法伤害", "INTEGER", "连皴山每秒基础20/35/50/65/80；实际跳率另待接线。", 120));
  add(fixed("qe_ap_ratio", "连皴山爆裂法强倍率", "DECIMAL", calcCoefficient("Hwei", "Q", "Tooltip_QEDamage", 1), "爆裂Tooltip_QEDamage系数0.3。", 130));
  add(fixed("qe_dps_ap_ratio", "连皴山每秒法强倍率", "DECIMAL", calcCoefficient("Hwei", "Q", "Tooltip_QEDamagePerSecond", 1), "区域每秒系数0.24。", 140));
  add(fixed("qe_zone_duration_ms", "连皴山岩浆池持续（毫秒）", "INTEGER", 2500, "区域持续2.5秒；按主负责人固定源值说明保存。", 150));
  add(fixed("qe_slow_ratio", "连皴山减速比例", "DECIMAL", 0.35, "35%减速按比例0.35保存；按主负责人固定源值说明保存。", 160));
  add(fixed("qe_damage_duration_ms", "连皴山原始伤害时序字段（毫秒）", "INTEGER", 500, "0.5秒只记录原始字段，不解释为伤害跳间隔；按主负责人固定源值说明保存。", 170));
  add(fixed("qe_cast_time_ms", "连皴山施法时间（毫秒）", "INTEGER", 350, "根说明明确连皴山施法350毫秒。", 180));
  add(fixed("qq_cast_time_ms", "没骨火施法时间（毫秒）", "INTEGER", 250, "根说明明确没骨火施法250毫秒。", 190));
  addFormula(formula("qq_magic_damage", "没骨火单敌魔法伤害", ADD(P("qq_damage_base"), MUL(P("qq_ap_ratio"), sourceAP())), "没骨火平伤部分=50/80/110/140/170+0.8×法强。", 200));
  addFormula(formula("qq_target_hp_damage", "没骨火目标最大生命附加伤害", MUL(MUL(P("qq_target_hp_percent_points"), P("percent_point_ratio")), targetHP()), "没骨火另加目标最大生命3%至7%。", 210));
  addFormula(formula("qq_total_magic_damage", "没骨火单敌总魔法伤害", ADD(ADD(P("qq_damage_base"), MUL(P("qq_ap_ratio"), sourceAP())), MUL(MUL(P("qq_target_hp_percent_points"), P("percent_point_ratio")), targetHP())), "总值=平伤+目标最大生命附加段。", 220));
  addFormula(formula("qw_base_magic_damage", "攒聚雷基础魔法伤害", ADD(P("qw_damage_base"), MUL(P("qw_ap_ratio"), sourceAP())), "基础伤害=60至160+0.3×法强。", 230));
  addFormula(formula("qw_max_condition_damage", "攒聚雷条件最高魔法伤害", MUL(P("qw_condition_max_multiplier"), ADD(P("qw_damage_base"), MUL(P("qw_ap_ratio"), sourceAP()))), "条件最高为整段乘源倍率；不猜中间低血曲线。", 240));
  addFormula(formula("qw_actual_damage", "攒聚雷当前条件魔法伤害", P("qw_actual_condition_damage"), "运行层提供当前孤立/定身和低血条件下实际值。", 250));
  addFormula(formula("qe_burst_magic_damage", "连皴山单次爆裂魔法伤害", ADD(P("qe_burst_base"), MUL(P("qe_ap_ratio"), sourceAP())), "爆裂=20至80+0.3×法强。", 260));
  addFormula(formula("qe_magic_damage_per_second", "连皴山区域每秒魔法伤害", ADD(P("qe_damage_per_second_base"), MUL(P("qe_dps_ap_ratio"), sourceAP())), "每秒=20至80+0.24×法强；不由DamageDuration推跳率。", 270));
}, [
  { item: "没骨火野怪额外上限、攒聚雷小兵野怪修正、连皴山小兵野怪修正", reason: "纯兵野分支。" },
  { item: "菜单选择250毫秒和技法各自额外消耗/冷却", reason: "菜单不等于施法；Q组公共冷却和消耗只复用一次。" },
], [
  { item: "攒聚雷低血中间曲线、连皴山重复爆裂与伤害跳率", reason: "使用无默认实际输入或仅保留原始时序字段。" },
], "九技法中的灾组保存在Q槽；没骨火生命段、攒聚雷整段倍率、连皴山爆裂与每秒伤害分开。");

define("Hwei", "W", "主题：靖", 5, (add, addFormula, addEffect) => {
  add(levelFrom("Hwei", "W", "Tooltip_WQBaseMoveSpeed", 5, "wq_move_speed_base", "飞染基础移动速度百分数点", "DECIMAL", "源值30/32.5/35/37.5/40百分数点。", 10));
  add(fixed("wq_ap_ratio", "飞染法强倍率", "DECIMAL", calcCoefficient("Hwei", "W", "Tooltip_WQMoveSpeed", 1), "飞染加成项0.03×法强，结果再乘0.01转比例。", 20));
  add(fixed("wq_percent_point_ratio", "飞染百分数点转比例", "DECIMAL", calc("Hwei", "W", "Tooltip_WQMoveSpeed").mMultiplier.mNumber, "来源树根乘数0.01，1表示100%的属性比例。", 30));
  add(levelFrom("Hwei", "W", "Tooltip_WQAreaDuration", 5, "wq_area_duration_ms", "飞染区域持续（毫秒）", "INTEGER", "区域持续4/4.5/5/5.5/6秒。", 40, 1, value => toMs(value, "Hwei/W/Tooltip_WQAreaDuration")));
  add(runtime("wq_personal_effect_duration_ms", "飞染自身个人效果持续（毫秒）", "INTEGER", "根Duration=1秒不是区域寿命；自身个人加速实际寿命由事件提供，不设默认。", 50));
  add(levelFrom("Hwei", "W", "Tooltip_WWShieldAmountBase", 5, "ww_shield_base", "渲浓满盾基础值", "INTEGER", "满盾100/140/180/220/260。", 60));
  add(fixed("ww_shield_ap_ratio", "渲浓法强倍率", "DECIMAL", calcCoefficient("Hwei", "W", "Tooltip_WWShieldAmount", 1), "满盾法强系数0.6。", 70));
  add(fixed("ww_initial_shield_multiplier", "渲浓初始护盾倍率", "DECIMAL", calc("Hwei", "W", "Tooltip_WWStartShieldAmount").mMultiplier.mNumber, "初始半盾，根乘数0.5。", 80));
  add(fixed("ww_area_duration_ms", "渲浓区域持续（毫秒）", "INTEGER", 3000, "根/区域持续3秒；按主负责人固定源值说明保存。", 90));
  add(fixed("ww_full_shield_time_ms", "渲浓到满盾时间（毫秒）", "INTEGER", 3000, "3秒内提升至满盾；按主负责人固定源值说明保存。", 100));
  add(fixed("ww_shield_duration_ms", "渲浓护盾原始持续（毫秒）", "INTEGER", 1000, "离区后或实例字段1秒，和区域寿命分开保存；按主负责人固定源值说明保存。", 110));
  add(levelFrom("Hwei", "W", "Tooltip_WEBaseOnHitDamage", 5, "we_onhit_base_damage", "宿墨每次基础魔法伤害", "INTEGER", "宿墨每次20/30/40/50/60。", 120));
  add(fixed("we_onhit_ap_ratio", "宿墨法强倍率", "DECIMAL", calcCoefficient("Hwei", "W", "Tooltip_WEOnHitDamage", 1), "每次额外伤害法强系数0.15。", 130));
  add(levelFrom("Hwei", "W", "Tooltip_WEOnHitManaRestore", 5, "we_mana_restore", "宿墨每次回蓝", "INTEGER", "每次回蓝45/50/55/60/65。", 140));
  add(fixed("we_duration_ms", "宿墨持续（毫秒）", "INTEGER", 9000, "原文9秒字段保留；不把匿名回蓝+3树当成三倍，按主负责人固定源值说明保存。", 150));
  add(fixed("we_charge_count", "宿墨可用次数", "INTEGER", 3, "正文明确下三次技能或攻击。", 160));
  add(fixedTime("Hwei", "W", "mCastTime", "w_group_m_cast_time_ms", "主题靖mCastTime（毫秒）", "组施法字段0.25秒，技法施法另按具体源对象保存。", 170));
  add(fixed("wq_cast_time_ms", "飞染施法时间（毫秒）", "INTEGER", 250, "飞染补充对象mCastTime/spellCastTime均为0.25秒。", 175));
  add(fixed("ww_m_cast_time_ms", "渲浓mCastTime（毫秒）", "INTEGER", 300, "渲浓补充对象mCastTime=0.3秒；与spellCastTime分开保留。", 176));
  add(fixed("ww_spell_cast_time_ms", "渲浓spellCastTime（毫秒）", "INTEGER", 250, "渲浓补充对象spellCastTime=0.25秒；不在冲突中任选一项。", 177));
  add(fixed("we_cast_time_ms", "宿墨施法时间（毫秒）", "INTEGER", 250, "宿墨补充对象mCastTime/spellCastTime均为0.25秒。", 178));
  addFormula(formula("wq_move_speed_ratio", "飞染自身移动速度比例", MUL(P("wq_percent_point_ratio"), ADD(P("wq_move_speed_base"), MUL(P("wq_ap_ratio"), sourceAP()))), "飞染=0.01×(30至40+0.03×法强)，结果为比例。", 180));
  addFormula(formula("ww_full_shield", "渲浓自身满额护盾", ADD(P("ww_shield_base"), MUL(P("ww_shield_ap_ratio"), sourceAP())), "自身满盾=100至260+0.6×法强。", 190));
  addFormula(formula("ww_initial_shield", "渲浓自身初始护盾", MUL(P("ww_initial_shield_multiplier"), ADD(P("ww_shield_base"), MUL(P("ww_shield_ap_ratio"), sourceAP()))), "自身初始护盾为满盾的50%。", 200));
  addFormula(formula("we_onhit_magic_damage", "宿墨每次额外魔法伤害", ADD(P("we_onhit_base_damage"), MUL(P("we_onhit_ap_ratio"), sourceAP())), "每次=20至60+0.15×法强。", 210));
  addFormula(formula("we_total_magic_damage", "宿墨三次额外魔法伤害", MUL(P("we_charge_count"), ADD(P("we_onhit_base_damage"), MUL(P("we_onhit_ap_ratio"), sourceAP()))), "三次总量=3×每次伤害。", 220));
  addFormula(formula("we_total_mana_restore", "宿墨三次回蓝总量", MUL(P("we_charge_count"), P("we_mana_restore")), "三次总回蓝=3×每次回蓝；只保留普攻触发P联动资格。", 230));
  addEffect(attrEffect("self_move_speed", "飞染自身移动速度", "补证支持自身受益；个人效果寿命由无默认运行输入提供。", "move_speed_percent", "FORMULA", "wq_move_speed_ratio", "wq_personal_effect_duration_ms", 20));
  addEffect(shieldEffect("self_shield", "渲浓自身初始护盾", "资格补证支持自身护盾；不把友军15%削减套到自身，也不把区域寿命当护盾寿命。", "ww_initial_shield", "ww_shield_duration_ms", 30));
  addEffect(resourceEffect("we_mana_restore", "宿墨三次回蓝", "mana", "FORMULA", "we_total_mana_restore", "RESTORE", 40));
}, [
  { item: "渲浓友军15%削减和其他友军目标", reason: "纯其他友方分支。" },
  { item: "菜单选择、组外独立冷却和多份法力消耗", reason: "三种技法共享W组冷却和消耗。" },
], [
  { item: "飞染个人寿命、渲浓护盾累积/离区事件、宿墨命中时点", reason: "事件层待接，所有运行输入无默认。" },
], "靖组保留飞染自身比例、渲浓自身初始/满盾和宿墨三次伤害回蓝；友军削减排除。");

define("Hwei", "E", "主题：悚", 5, (add, addFormula, addEffect) => {
  add(levelFrom("Hwei", "E", "Tooltip_EQBaseDamage", 5, "eq_damage_base", "阴沉变意基础魔法伤害", "INTEGER", "九技法源值70/110/150/190/230。", 10));
  add(fixed("eq_ap_ratio", "阴沉变意法强倍率", "DECIMAL", calcCoefficient("Hwei", "E", "Tooltip_EQDamage", 1), "阴沉变意系数0.65。", 20));
  add(levelFrom("Hwei", "E", "Tooltip_EQFleeDuration", 5, "eq_flee_duration_ms", "阴沉变意逃跑持续（毫秒）", "INTEGER", "逃跑1/1.125/1.25/1.375/1.5秒。", 30, 1, value => toMs(value, "Hwei/E/Tooltip_EQFleeDuration")));
  add(fixed("eq_cast_time_ms", "阴沉变意施法时间（毫秒）", "INTEGER", 250, "技法源对象mCastTime=0.25秒。", 40));
  add(levelFrom("Hwei", "E", "Tooltip_EWBaseDamage", 5, "ew_damage_base", "滞涩幽瞳基础魔法伤害", "INTEGER", "九技法源值70/110/150/190/230。", 50));
  add(fixed("ew_ap_ratio", "滞涩幽瞳法强倍率", "DECIMAL", calcCoefficient("Hwei", "E", "Tooltip_EWDamage", 1), "滞涩幽瞳系数0.65。", 60));
  add(levelFrom("Hwei", "E", "Tooltip_EWRootDuration", 5, "ew_root_duration_ms", "滞涩幽瞳禁锢持续（毫秒）", "INTEGER", "禁锢1.2/1.4/1.6/1.8/2秒。", 70, 1, value => toMs(value, "Hwei/E/Tooltip_EWRootDuration")));
  add(fixed("ew_stare_duration_ms", "滞涩幽瞳眼眸探测持续（毫秒）", "INTEGER", toMs(techniqueDataAt("HweiEW", "StareDuration"), "HweiEW/StareDuration"), "眼眸探测持续直接取补充对象StareDuration=3秒；根技能的定身Duration单独保留。", 80));
  add(fixed("ew_setup_delay_ms", "滞涩幽瞳准备延迟（毫秒）", "INTEGER", 650, "补充对象SetupDelay=0.65秒。", 90));
  add(fixed("ew_fire_delay_ms", "滞涩幽瞳发射延迟（毫秒）", "INTEGER", 300, "补充对象FireDelay=0.3秒。", 100));
  add(fixed("ew_eye_detection_radius", "滞涩幽瞳眼眸探测半径", "INTEGER", 450, "补充对象VisibilityRadius=450；保留探测控制，不创建独立攻击召唤物。", 110));
  add(fixed("ew_cast_time_ms", "滞涩幽瞳施法时间（毫秒）", "INTEGER", 250, "技法源对象mCastTime=0.25秒。", 120));
  add(levelFrom("Hwei", "E", "Tooltip_EEBaseDamage", 5, "ee_damage_base", "双钩血喉基础魔法伤害", "INTEGER", "九技法源值70/110/150/190/230。", 130));
  add(fixed("ee_ap_ratio", "双钩血喉法强倍率", "DECIMAL", calcCoefficient("Hwei", "E", "Tooltip_EEDamage", 1), "双钩血喉系数0.65。", 140));
  add(levelFrom("Hwei", "E", "Tooltip_EESlowAmount", 5, "ee_slow_percent_points", "双钩血喉减速百分数点", "DECIMAL", "减速40/47.5/55/62.5/70百分数点，结果保留百分数点单位。", 150));
  add(fixed("ee_slow_duration_ms", "双钩血喉减速衰减持续（毫秒）", "INTEGER", 1250, "正文明确1.25秒内持续衰减。", 160));
  add(fixed("ee_cast_time_ms", "双钩血喉施法时间（毫秒）", "INTEGER", 350, "补充对象mCastTime约0.35秒，转换为350毫秒。", 170));
  addFormula(formula("eq_magic_damage", "阴沉变意单敌魔法伤害", ADD(P("eq_damage_base"), MUL(P("eq_ap_ratio"), sourceAP())), "阴沉变意=70至230+0.65×法强。", 180));
  addFormula(formula("ew_magic_damage", "滞涩幽瞳单敌魔法伤害", ADD(P("ew_damage_base"), MUL(P("ew_ap_ratio"), sourceAP())), "滞涩幽瞳=70至230+0.65×法强。", 190));
  addFormula(formula("ee_magic_damage", "双钩血喉单敌魔法伤害", ADD(P("ee_damage_base"), MUL(P("ee_ap_ratio"), sourceAP())), "双钩血喉=70至230+0.65×法强。", 200));
  addFormula(formula("ee_slow_percent_points", "双钩血喉减速百分数点", P("ee_slow_percent_points"), "只记录减速幅度，递减过程由运行事件处理。", 210));
}, [
  { item: "纯视野展示和独立可攻击召唤单位", reason: "眼眸只保留探测、锁定和追踪飞弹控制伤害；无独立攻击单位证据。" },
  { item: "E组每技法独立冷却与消耗", reason: "三种技法共享E组公共冷却和消耗，菜单选择不消费。" },
], [
  { item: "眼眸探测触发、最近目标选择、飞弹命中时点和减速衰减", reason: "链路字段保留，事件资格待接线。" },
], "悚组九技法同数值不合并身份；保留眼眸探测追踪链的控制伤害与准备/发射时序。");

define("Hwei", "R", "焚心绚华绘", 3, (add, addFormula) => {
  add(levelFrom("Hwei", "R", "RBaseDamage", 3, "explosion_base_damage", "终结爆炸基础魔法伤害", "INTEGER", "RBaseDamage索引1至3：200/325/450。", 10, 1));
  add(levelFrom("Hwei", "R", "BaseDamageOverTime", 3, "dot_base_damage_per_second", "每秒持续伤害基础值", "INTEGER", "每秒10/20/30。", 20, 1));
  add(fixed("explosion_ap_ratio", "终结爆炸法强倍率", "DECIMAL", calcCoefficient("Hwei", "R", "Damage", 1), "爆炸系数0.8。", 30));
  add(fixed("dot_ap_ratio", "每秒持续伤害法强倍率", "DECIMAL", calcCoefficient("Hwei", "R", "DamageOverTime", 1), "持续伤害系数0.05。", 40));
  add(fixed("total_max_ap_ratio", "完整最大伤害法强倍率", "DECIMAL", part("Hwei", "R", "TotalMaxDamage", 1).mCoefficient, "最大伤害树最终法强系数0.95。", 50));
  add(fixedFrom("Hwei", "R", "Duration", "duration_ms", "画卷持续（毫秒）", "INTEGER", "正文明确3秒。", 60, 1, value => toMs(value, "Hwei/R/Duration")));
  add(fixedFrom("Hwei", "R", "Duration", "duration_seconds", "画卷持续（秒，用于每秒伤害合计）", "DECIMAL", "同一3秒源值仅用于每秒伤害总量计算。", 70));
  add(fixedFrom("Hwei", "R", "SlowPercentPerStack", "slow_stack_percent_points", "每周期减速百分数点", "DECIMAL", "每0.25秒增加10百分数点；不把周期当伤害跳率。", 80));
  add(fixed("slow_stack_period_ms", "减速叠加周期（毫秒）", "INTEGER", 250, "正文明确每0.25秒增加减速。", 90));
  add(fixed("slow_fade_duration_ms", "减速单层衰减持续（毫秒）", "INTEGER", toMs(dataAt("Hwei", "R", "SlowDuration"), "Hwei/R/SlowDuration"), "源字段0.35秒；与伤害周期分开。", 100));
  add(fixedTime("Hwei", "R", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "与spellCastTime并列保留，不任取唯一施法时间。", 110));
  add(fixedTime("Hwei", "R", "spellCastTime", "spell_cast_time_ms", "客户端spellCastTime（毫秒）", "与mCastTime并列保留，不任取唯一施法时间。", 120));
  addFormula(formula("explosion_magic_damage", "焚心绚华绘终结爆炸魔法伤害", ADD(P("explosion_base_damage"), MUL(P("explosion_ap_ratio"), sourceAP())), "爆炸=200/325/450+0.8×法强。", 130));
  addFormula(formula("dot_magic_damage_per_second", "焚心绚华绘每秒魔法伤害", ADD(P("dot_base_damage_per_second"), MUL(P("dot_ap_ratio"), sourceAP())), "每秒=10/20/30+0.05×法强。", 140));
  addFormula(formula("total_max_magic_damage", "焚心绚华绘完整最大魔法伤害", ADD(ADD(P("explosion_base_damage"), MUL(P("dot_base_damage_per_second"), P("duration_seconds"))), MUL(P("total_max_ap_ratio"), sourceAP())), "完整最大=爆炸基础+每秒基础×3+0.95×法强，得到230/385/540+0.95AP。", 150));

}, [
  { item: "每0.25秒持续伤害跳率", reason: "0.25秒是减速叠加周期，不替代伤害跳率。" },
  { item: "旧MaxDamageHelper=230/360/490", reason: "当前TotalMaxDamage源树为230/385/540，旧辅助值不覆盖当前树。" },
], [
  { item: "减速上限、递减和伤害跳率", reason: "保留源周期与每秒公式，实际事件资格待接线。" },
], "保留持续3秒、每秒伤害、终结爆炸和当前最大伤害树；减速周期独立保存。");

// 洛克
define("Locke", "P", "圣银穿心", 1, (add, addFormula) => {
  add(runtime("actual_min_onhit_base", "当前最低附魔基础伤害", "DECIMAL", "最低附魔基础值为5至40的哈希插值，运行层提供当前值，不设默认。", 10));
  add(fixed("min_onhit_base_lower", "最低附魔基础下界", "INTEGER", dataAt("Locke", "P", "MinOnHitStartValue"), "最低伤害插值下界5。", 20));
  add(fixed("min_onhit_base_upper", "最低附魔基础上界", "INTEGER", dataAt("Locke", "P", "MinOnHitEndValue"), "最低伤害插值上界40。", 30));
  add(fixed("min_onhit_ap_ratio", "最低附魔法强倍率", "DECIMAL", calcCoefficient("Locke", "P", "MinOnHitDamage", 1), "最低附魔法强系数0.1。", 40));
  add(runtime("actual_max_onhit_base", "当前最高附魔基础伤害", "DECIMAL", "最高附魔基础值为10至80的哈希插值，运行层提供当前值，不设默认。", 50));
  add(fixed("max_onhit_base_lower", "最高附魔基础下界", "INTEGER", dataAt("Locke", "P", "MaxOnHitStartValue"), "最高伤害插值下界10。", 60));
  add(fixed("max_onhit_base_upper", "最高附魔基础上界", "INTEGER", dataAt("Locke", "P", "MaxOnHitEndValue"), "最高伤害插值上界80。", 70));
  add(fixed("max_onhit_ap_ratio", "最高附魔法强倍率", "DECIMAL", calcCoefficient("Locke", "P", "MaxOnHitDamage", 1), "最高附魔法强系数0.2。", 80));
  add(fixed("max_reach_remaining_health_ratio", "达到最高伤害的剩余生命比例", "DECIMAL", 0.3, "正文明确目标30%剩余生命达到最高值。", 90));
  add(runtime("actual_target_missing_health_ratio", "当前目标已损生命比例", "DECIMAL", "中间血量插值算法未证，运行层提供实际目标已损生命比例，不设默认。", 100));
  addFormula(formula("minimum_magic_damage", "圣银穿心最低魔法伤害", ADD(P("actual_min_onhit_base"), MUL(P("min_onhit_ap_ratio"), sourceAP())), "最低档=当前插值基础+0.1×法强。", 110));
  addFormula(formula("maximum_magic_damage", "圣银穿心最高魔法伤害", ADD(P("actual_max_onhit_base"), MUL(P("max_onhit_ap_ratio"), sourceAP())), "最高档=当前插值基础+0.2×法强。", 120));
}, [
  { item: "spellCastTime=0", reason: "被动不可主动施放，不生成0毫秒施法占位。" },
], [
  { item: "两条哈希插值曲线和目标血量中间算法", reason: "使用无默认角色/目标实际输入。" },
], "保留最低与最高附魔伤害两端；不将30%剩余生命阈值扩写成未知中间曲线。");

define("Locke", "Q", "伏魔三钉", 5, (add, addFormula) => {
  add(levelFrom("Locke", "Q", "BaseMissileDamage", 5, "missile_damage_base", "单颗驱魔大钉基础魔法伤害", "INTEGER", "每颗40/48/56/64/72。", 10));
  add(fixed("missile_ap_ratio", "驱魔大钉法强倍率", "DECIMAL", calcCoefficient("Locke", "Q", "MissileDamage", 1), "每颗法强系数0.2。", 20));
  add(levelFrom("Locke", "Q", "MarkDamage", 5, "mark_damage_base", "每层印记基础魔法伤害", "INTEGER", "每层18/26/34/42/50。", 30, 1));
  add(levelFrom("Locke", "Q", "MarkRatio", 5, "mark_ap_ratio", "每层印记法强倍率", "DECIMAL", "每层系数0.25/0.275/0.3/0.325/0.35。", 40, 1));
  add(fixedFrom("Locke", "Q", "MaxStacks", "max_mark_stacks", "最大印记层数", "INTEGER", "最多3层。", 50));
  add(fixedFrom("Locke", "Q", "Duration", "skill_duration_ms", "技能标记窗口（毫秒）", "INTEGER", "技能持续4秒。", 60, 1, value => toMs(value, "Locke/Q/Duration")));
  add(fixedFrom("Locke", "Q", "NailDuration", "mark_duration_ms", "钉印记持续（毫秒）", "INTEGER", "钉印记持续4秒。", 70, 1, value => toMs(value, "Locke/Q/NailDuration")));
  add(fixedFrom("Locke", "Q", "SlowAmount1", "slow_first_ratio", "第一颗减速比例", "DECIMAL", "前两次25%减速，比例单位。", 80));
  add(fixedFrom("Locke", "Q", "SlowAmount2", "slow_second_ratio", "第二颗减速比例", "DECIMAL", "前两次25%减速，比例单位。", 90));
  add(fixedFrom("Locke", "Q", "SlowAmount3", "slow_third_ratio", "第三颗减速比例", "DECIMAL", "第三次60%减速，比例单位。", 100));
  add(fixedFrom("Locke", "Q", "SlowDuration1", "slow_first_duration_ms", "第一颗减速持续（毫秒）", "INTEGER", "第一颗1秒。", 110, 1, value => toMs(value, "Locke/Q/SlowDuration1")));
  add(fixedFrom("Locke", "Q", "SlowDuration2", "slow_second_duration_ms", "第二颗减速持续（毫秒）", "INTEGER", "第二颗1秒。", 120, 1, value => toMs(value, "Locke/Q/SlowDuration2")));
  add(fixedFrom("Locke", "Q", "SlowDuration3", "slow_third_duration_ms", "第三颗减速持续（毫秒）", "INTEGER", "第三颗2秒。", 130, 1, value => toMs(value, "Locke/Q/SlowDuration3")));
  add(fixed("two_mark_multiplier", "两层印记整段倍率", "DECIMAL", 1.2, "两层额外20%，作用于两层整段伤害。", 140));
  add(fixed("three_mark_multiplier", "三层印记整段倍率", "DECIMAL", 1.4, "三层额外40%，作用于三层整段伤害。", 150));
  add(runtime("unused_nail_cooldown_refund_ratio", "未使用大钉当前冷却返还比例", "DECIMAL", "AmmoCooldownReset为角色等级20%至35%插值，中间算法未证，运行层提供实际比例，不设默认。", 160));
  add(fixed("nail_count", "依次发射的大钉数量", "INTEGER", dataAt("Locke", "Q", "Ammo"), "正文明确三颗；根施法0不表示三颗同刻命中。", 170));
  addFormula(formula("missile_magic_damage", "伏魔三钉单颗魔法伤害", ADD(P("missile_damage_base"), MUL(P("missile_ap_ratio"), sourceAP())), "每颗=40至72+0.2×法强。", 180));
  addFormula(formula("mark_magic_damage", "伏魔三钉每层印记魔法伤害", ADD(P("mark_damage_base"), MUL(P("mark_ap_ratio"), sourceAP())), "每层=18至50+0.25至0.35×法强。", 190));
  addFormula(formula("two_mark_magic_damage", "伏魔三钉两层整段魔法伤害", MUL(P("two_mark_multiplier"), ADD(P("mark_damage_base"), MUL(P("mark_ap_ratio"), sourceAP()))), "两层整段按1.2倍处理。", 200));
  addFormula(formula("three_mark_magic_damage", "伏魔三钉三层整段魔法伤害", MUL(P("three_mark_multiplier"), ADD(P("mark_damage_base"), MUL(P("mark_ap_ratio"), sourceAP()))), "三层整段按1.4倍处理。", 210));
}, [
  { item: "回蓝数值", reason: "冻结源未给明确回蓝数值，不能填默认。" },
], [
  { item: "未用钉返还曲线、三颗命中时点和普攻消费事件", reason: "只保留已知数值和无默认运行输入。" },
], "保留三颗弹体、每层伤害、多层整段倍率、三档减速和两类持续时间；不把根施法时间0当命中时点。");

define("Locke", "W", "灵焰仪式", 5, (add, addFormula, addEffect) => {
  add(runtime("actual_attack_speed_ratio", "当前角色等级攻击速度比例", "DECIMAL", "AttackSpeed为角色等级40%至70%插值，中间算法未证，运行层提供实际比例，不设默认。", 10));
  add(fixed("attack_speed_level1_ratio", "攻击速度比例下界", "DECIMAL", calc("Locke", "W", "AttackSpeed").mFormulaParts[0].mStartValue, "角色等级插值下界，比例属性。", 20));
  add(fixed("attack_speed_level18_ratio", "攻击速度比例上界", "DECIMAL", calc("Locke", "W", "AttackSpeed").mFormulaParts[0].mEndValue, "角色等级插值上界，比例属性。", 30));
  add(fixedFrom("Locke", "W", "BaseMoveSpeed", "move_speed_base_ratio", "初始移动速度比例", "DECIMAL", "初始移速0.4，比例单位。", 40));
  add(fixed("move_speed_ap_ratio", "初始移动速度法强倍率", "DECIMAL", calcCoefficient("Locke", "W", "MoveSpeed", 1), "初始移速法强系数0.0002。", 50));
  add(fixedFrom("Locke", "W", "MinMoveSpeed", "move_speed_min_ratio", "衰减后移动速度比例", "DECIMAL", "衰减后下限0.2，比例单位。", 60));
  add(fixedFrom("Locke", "W", "DecayTime", "decay_time_ms", "衰减第一段时间（毫秒）", "INTEGER", "DecayTime=1秒。", 70, 1, value => toMs(value, "Locke/W/DecayTime")));
  add(fixedFrom("Locke", "W", "TimeMaxPower", "time_max_power_ms", "衰减第二段时间（毫秒）", "INTEGER", "TimeMaxPower=1秒。", 80, 1, value => toMs(value, "Locke/W/TimeMaxPower")));
  add(fixedFrom("Locke", "W", "BaseDuration", "self_burn_duration_ms", "持续时间（毫秒）", "INTEGER", "最多持续6秒。", 90, 1, value => toMs(value, "Locke/W/BaseDuration")));
  add(fixedFrom("Locke", "W", "HealthCost", "current_health_cost_ratio", "每秒当前生命自伤比例", "DECIMAL", "每秒损失当时当前生命2%，比例单位。", 100));
  add(levelFrom("Locke", "W", "BaseDamageRestoreAmount", 5, "damage_restore_base", "受伤返还基础数额", "INTEGER", "源值40/60/80/100/120，是数额不是百分比。", 110));
  add(fixed("damage_restore_ap_ratio", "受伤返还法强倍率", "DECIMAL", calcCoefficient("Locke", "W", "DamageRestoreAmount", 1), "返还数额法强系数1。", 120));
  add(runtime("actual_additional_heal", "当前额外治疗数额", "DECIMAL", "AdditionalHeal角色等级40至200+0.2法强，已损生命和持续时间交互未证，运行层提供当前数额，不设默认。", 130));
  add(fixed("additional_heal_level1_base", "额外治疗等级1基础值", "INTEGER", calc("Locke", "W", "AdditionalHeal").mFormulaParts[0].mStartValue, "插值下界40。", 140));
  add(fixed("additional_heal_level18_base", "额外治疗等级18基础值", "INTEGER", calc("Locke", "W", "AdditionalHeal").mFormulaParts[0].mEndValue, "插值上界200。", 150));
  add(fixed("additional_heal_ap_ratio", "额外治疗法强倍率", "DECIMAL", calcCoefficient("Locke", "W", "AdditionalHeal", 1), "额外治疗法强系数0.2。", 160));
  add(runtime("actual_max_healing_threshold", "当前剩余生命治疗上限", "DECIMAL", "MaxHealingThreshold角色等级150至450+0.6法强，完整治疗交互未证，运行层提供当前值，不设默认。", 170));
  add(fixed("max_healing_level1_base", "剩余生命上限等级1基础值", "INTEGER", dataAt("Locke", "W", "HealCapLevel1Value"), "上限插值起点150。", 180));
  add(fixed("max_healing_level18_base", "剩余生命上限等级18基础值", "INTEGER", dataAt("Locke", "W", "HealCapLevel18Value"), "上限插值终点450。", 190));
  add(fixed("max_healing_ap_ratio", "剩余生命上限法强倍率", "DECIMAL", dataAt("Locke", "W", "HealCapAPRatio"), "上限法强系数0.6。", 200));
  addFormula(formula("initial_move_speed_ratio", "灵焰仪式初始移动速度比例", ADD(P("move_speed_base_ratio"), MUL(P("move_speed_ap_ratio"), sourceAP())), "初始移速=0.4+0.0002×法强。", 210));
  addFormula(formula("decay_total_time_ms", "灵焰仪式移动速度衰减总时长", ADD(P("decay_time_ms"), P("time_max_power_ms")), "DecayTimeHelper=1+1=2秒。", 220));
  addFormula(formula("attack_speed_ratio", "灵焰仪式攻击速度比例", P("actual_attack_speed_ratio"), "使用无默认角色等级实际攻速比例。", 230));
  addFormula(formula("self_damage_per_second", "灵焰仪式每秒自身真实伤害", MUL(P("current_health_cost_ratio"), sourceHP()), "每秒2%当时当前生命；当前生命变化由运行时逐秒提供。", 240));
  addFormula(formula("damage_restore_amount", "灵焰仪式受伤返还数额", ADD(P("damage_restore_base"), MUL(P("damage_restore_ap_ratio"), sourceAP())), "返还数额=40至120+1×法强。", 250));
  addFormula(formula("additional_heal_amount", "灵焰仪式额外治疗数额", P("actual_additional_heal"), "运行层提供已损生命和持续时间交互后的实际额外治疗。", 260));
  addFormula(formula("max_healing_threshold", "灵焰仪式剩余生命治疗上限", P("actual_max_healing_threshold"), "运行层提供当前角色等级和法强后的实际上限。", 270));
  addEffect(attrEffect("self_attack_speed", "灵焰仪式自身攻击速度", "自身攻击速度比例；等级插值由无默认运行输入提供。", "bonus_attack_speed_percent", "FORMULA", "attack_speed_ratio", "self_burn_duration_ms", 20));
  addEffect(attrEffect("self_move_speed", "灵焰仪式自身移动速度", "自身初始移动速度比例；按1+1秒衰减窗口保存。", "move_speed_percent", "FORMULA", "initial_move_speed_ratio", "decay_total_time_ms", 30));
}, [
  { item: "幽灵和被控制时可施放", reason: "资格和状态由事件层处理，不制造独立属性。" },
], [
  { item: "攻速角色等级中间曲线、每秒当前生命变化、治疗交互", reason: "分别保留端点或无默认实际输入。" },
], "保留当前生命自伤、两段衰减窗口、返还数额和两套治疗端点；不把最大生命或起始生命代替当时当前生命。");

define("Locke", "E", "灰猎无影", 5, (add, addFormula) => {
  add(levelFrom("Locke", "E", "BaseOnHitDamage", 5, "onhit_damage_base", "抵达附近基础魔法伤害", "INTEGER", "抵达伤害40/50/60/70/80。", 10));
  add(fixed("onhit_ap_ratio", "抵达附近法强倍率", "DECIMAL", calcCoefficient("Locke", "E", "OnHitDamage", 1), "抵达伤害法强系数0.4。", 20));
  add(levelFrom("Locke", "E", "BaseDashDamage", 5, "dash_damage_base", "下一次攻击冲刺基础魔法伤害", "INTEGER", "冲刺伤害40/60/80/100/120。", 30));
  add(fixedFrom("Locke", "E", "APRatio", "dash_ap_ratio", "冲刺攻击法强倍率", "DECIMAL", "当前树使用0.4法强。", 40));
  add(fixedFrom("Locke", "E", "E2AttackDelay", "next_attack_delay_ms", "下次攻击延迟（毫秒）", "INTEGER", "下次攻击阶段0.1秒。", 50, 1, value => toMs(value, "Locke/E/E2AttackDelay")));
  add(fixedTime("Locke", "E", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "根字段0.175秒；与spellCastTime=0并列，不选择0作为唯一施法时间。", 60));
  addFormula(formula("arrival_magic_damage", "灰猎无影抵达魔法伤害", ADD(P("onhit_damage_base"), MUL(P("onhit_ap_ratio"), sourceAP())), "抵达=40至80+0.4×法强。", 70));
  addFormula(formula("dash_magic_damage", "灰猎无影冲刺魔法伤害", ADD(P("dash_damage_base"), MUL(P("dash_ap_ratio"), sourceAP())), "冲刺=40至120+0.4×法强。", 80));
}, [
  { item: "官方10秒冷却", reason: "根对象没有cooldownTime且不在26公共参数中；按审计要求不静默补入。" },
], [
  { item: "击杀刷新、两段同敌命中和Q标记消费时点", reason: "跨事件资格待接线。" },
], "保留抵达和下一次攻击冲刺两段单敌伤害；官方冷却值只留范围说明，不静默新建。");

define("Locke", "R", "万魔狱", 3, (add, addFormula) => {
  add(levelFrom("Locke", "R", "BaseDamage", 3, "damage_base", "封印法器基础魔法伤害", "INTEGER", "基础150/225/300。", 10));
  add(fixed("damage_ap_ratio", "封印法器法强倍率", "DECIMAL", calcCoefficient("Locke", "R", "Damage", 1), "伤害系数0.6。", 20));
  add(fixedFrom("Locke", "R", "SlowAmount", "slow_ratio", "封印法器减速比例", "DECIMAL", "99%减速按比例0.99保存。", 30));
  add(fixedFrom("Locke", "R", "SlowDuration", "slow_duration_ms", "减速持续（毫秒）", "INTEGER", "衰减慢持续2秒。", 40, 1, value => toMs(value, "Locke/R/SlowDuration")));
  add(fixedFrom("Locke", "R", "Duration", "mark_duration_ms", "法器标记持续（毫秒）", "INTEGER", "标记持续5秒。", 50, 1, value => toMs(value, "Locke/R/Duration")));
  add(levelFrom("Locke", "R", "ExecutionThreshold", 3, "execute_base_ratio", "基础处决阈值比例", "DECIMAL", "基础阈值10/11/12%，按比例保存。", 60, 1));
  add(fixedFrom("Locke", "R", "ExecuteThresholdPerStack", "execute_ratio_per_stack", "每层永久处决阈值增量", "DECIMAL", "每层增加0.5百分点，比例0.005。", 70));
  add(runtime("sealed_hero_count", "当前已封印英雄数量", "INTEGER", "处决阈值层数来自已封印英雄数，事件层提供，不设默认。", 80));
  add(runtime("ground_artifact_duration_ms", "地面法器实际存留（毫秒）", "INTEGER", "存留时长等于封印发生时该技能当前剩余冷却，运行层提供，不填固定常数。", 90));
  add(fixedFrom("Locke", "R", "CooldownReduction", "total_cooldown_refund_ratio", "拾取法器总冷却返还比例", "DECIMAL", "每封印英雄拾取返还总冷却20%，比例单位。", 100, 1, ratio));
  add(fixedTime("Locke", "R", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "施法阶段0.25秒。", 110));
  addFormula(formula("magic_damage", "万魔狱封印法器魔法伤害", ADD(P("damage_base"), MUL(P("damage_ap_ratio"), sourceAP())), "封印伤害=150/225/300+0.6×法强。", 120));
  addFormula(formula("execute_bonus_ratio", "万魔狱永久阈值增量", MUL(P("sealed_hero_count"), P("execute_ratio_per_stack")), "每个已封印英雄增加0.005比例。", 130));
  addFormula(formula("execute_threshold_ratio", "万魔狱当前处决阈值", ADD(P("execute_base_ratio"), MUL(P("sealed_hero_count"), P("execute_ratio_per_stack"))), "当前阈值=基础10/11/12%+每层0.5百分点；不宣称处决事件已接线。", 140));
}, [
  { item: "旧每层技能急速6", reason: "当前正文未消费。" },
  { item: "其他敌方目标续标记和法器独立攻击召唤物", reason: "额外敌人和独立攻击单位范围外；法器仅作为伤害/阈值载体。" },
], [
  { item: "ExecuteTooltipCalc对应资格与实际处决事件", reason: "根树匿名阈值树已保存，但命中/处决事件待补证。" },
], "保留唯一敌人封印伤害、99%减速、5秒标记和基础+封印层数阈值；地面法器存留使用无默认当前剩余冷却。");

// 亚恒
define("Zaahen", "P", "不落之志", 1, (add, addFormula, addEffect) => {
  add(runtime("stack_count", "当前果决层数", "INTEGER", "攻击或技能命中唯一敌方英雄所得层数由运行状态提供，不设默认。", 10));
  add(fixedFrom("Zaahen", "P", "MaxStacks", "max_stacks", "果决最大层数", "INTEGER", "正文明确12层。", 20));
  add(runtime("actual_bonus_ad_per_stack_ratio", "当前每层额外攻击力比例", "DECIMAL", "PercentBonusADCalc为1.5%至2.8%角色等级插值，运行层提供实际比例，不设默认，避免自引用。", 30));
  add(fixed("bonus_ad_per_stack_lower_ratio", "每层额外攻击力比例下界", "DECIMAL", dataAt("Zaahen", "P", "PBonusADMin"), "哈希插值下界1.5%，比例单位。", 40));
  add(fixed("bonus_ad_per_stack_upper_ratio", "每层额外攻击力比例上界", "DECIMAL", dataAt("Zaahen", "P", "PBonusADMax"), "哈希插值上界2.8%，比例单位。", 50));
  add(fixedFrom("Zaahen", "P", "MaxStacksMultiplier", "full_stack_multiplier", "满层攻击力倍率", "DECIMAL", "满层将已提供攻击力翻倍。", 60));
  add(fixedFrom("Zaahen", "P", "FallOffDuration", "stack_falloff_duration_ms", "果决层数衰减持续（毫秒）", "INTEGER", "层数衰减窗口5秒。", 70, 1, value => toMs(value, "Zaahen/P/FallOffDuration")));
  add(fixedFrom("Zaahen", "P", "ReviveDuration", "stasis_revive_duration_ms", "凝滞复活持续（毫秒）", "INTEGER", "凝滞持续4秒；这是本体生存机制，不是形态。", 80, 1, value => toMs(value, "Zaahen/P/ReviveDuration")));
  add(character("revive_cooldown_ms", "复活冷却（毫秒）", "INTEGER", Object.fromEntries(Array.from({ length: 18 }, (_, index) => {
    const level = index + 1;
    const value = level >= 16 ? 120000 : level >= 11 ? 180000 : level >= 6 ? 240000 : 300000;
    return [String(level), value];
  })), "ReviveCooldownCalc=300秒，6/11/16级各减少60秒；展开为完整18级整数毫秒数组。", 90));
  add(runtime("actual_revive_health_ratio", "当前复活生命比例", "DECIMAL", "RevivePercentCalc的1级0.3和6/11/16断点增量明确，但空字段语义未证明；运行层提供实际比例，不设默认。", 100));
  add(fixed("revive_health_level1_ratio", "复活生命比例1级起点", "DECIMAL", dataAt("Zaahen", "P", "ReviveLevel1Value"), "哈希断点起点0.3，比例单位。", 110));
  add(fixed("revive_health_breakpoint_bonus_ratio", "复活生命比例断点增量", "DECIMAL", dataAt("Zaahen", "P", "ReviveAdditionalBonusAtThisLevel"), "6/11/16级各有0.15增量；空斜率不补0。", 120));
  addFormula(formula("bonus_ad_ratio_total", "不落之志当前额外攻击力比例", MUL(P("stack_count"), P("actual_bonus_ad_per_stack_ratio")), "当前额外攻击力比例=层数×实际每层比例，不循环引用自身攻击力。", 130));
  addFormula(formula("full_stack_bonus_ad_ratio", "不落之志满层额外攻击力比例", MUL(P("full_stack_multiplier"), MUL(P("stack_count"), P("actual_bonus_ad_per_stack_ratio"))), "满层将已提供攻击力翻倍。", 140));
  addFormula(formula("revive_health_ratio", "不落之志当前复活生命比例", P("actual_revive_health_ratio"), "运行层提供空字段语义核对后的实际比例。", 150));
  addFormula(formula("revive_cooldown", "不落之志复活冷却", P("revive_cooldown_ms"), "使用完整18级复活冷却数组；不使用被动cooldownTime=100。", 160));
  addEffect(attrEffect("bonus_attack_damage", "不落之志自身额外攻击力", "比例攻击力按固定加算区域承接；基础攻击力由运行层提供，不引入自引用。", "attack_damage", "FORMULA", "bonus_ad_ratio_total", null, 20));
}, [
  { item: "PercentBonusAD=2.5%旧常量", reason: "未消费，改用哈希插值端点和无默认实际比例。" },
  { item: "被动cooldownTime=100", reason: "未消费，不替代复活300秒断点冷却。" },
], [
  { item: "复活生命比例空字段、层数触发和本体生存事件", reason: "空字段不补0，事件层待接线。" },
], "复活冷却按断点完整展开；比例攻击力用无默认实际值和attribute_flat_add，不循环引用。");

define("Zaahen", "Q", "暗裔长刀", 5, (add, addFormula) => {
  add(levelFrom("Zaahen", "Q", "Q1BaseDamage", 5, "first_attack_base_damage", "第一强化攻击基础物理伤害", "INTEGER", "第一段15/30/45/60/75。", 10));
  add(levelFrom("Zaahen", "Q", "QCoeff", 5, "bonus_ad_ratio", "强化攻击额外攻击力倍率", "DECIMAL", "QCoeff为0.2/0.25/0.3/0.35/0.4。", 20));
  add(levelFrom("Zaahen", "Q", "Q2BaseDamage", 5, "recast_attack_base_damage", "再次施放攻击基础物理伤害", "INTEGER", "第二段25/50/75/100/125。", 30));
  add(levelFrom("Zaahen", "Q", "HealPercent", 5, "self_max_health_heal_ratio", "第一段自身最大生命治疗比例", "DECIMAL", "治疗5/6/7/8/9%，比例单位。", 40));
  add(fixedFrom("Zaahen", "Q", "KnockUpDuration", "knockup_duration_ms", "再次施放击飞持续（毫秒）", "INTEGER", "击飞0.75秒。", 50, 1, value => toMs(value, "Zaahen/Q/KnockUpDuration")));
  add(fixedFrom("Zaahen", "Q", "RecastWindow", "recast_window_ms", "再次施放窗口（毫秒）", "INTEGER", "4秒窗口。", 60, 1, value => toMs(value, "Zaahen/Q/RecastWindow")));
  add(fixedFrom("Zaahen", "Q", "TimeBetweenAttacks", "time_between_attacks_ms", "两次攻击间隔（毫秒）", "INTEGER", "两次攻击间1.5秒。", 70, 1, value => toMs(value, "Zaahen/Q/TimeBetweenAttacks")));
  add(fixed("strike_count", "第一强化攻击斩击次数", "INTEGER", 2, "正文描述下一次攻击进行两次斩击；不把附加伤害和治疗整体乘2。", 80));
  addFormula(formula("first_attack_physical_damage", "暗裔长刀第一段额外物理伤害", ADD(P("first_attack_base_damage"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "第一段=15至75+0.2至0.4×来源额外攻击力。", 90));
  addFormula(formula("recast_attack_physical_damage", "暗裔长刀再次施放额外物理伤害", ADD(P("recast_attack_base_damage"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "再次施放=25至125+同一额外攻击力倍率。", 100));
  addFormula(formula("self_max_health_heal_ratio", "暗裔长刀自身最大生命治疗比例", P("self_max_health_heal_ratio"), "自身治疗比例5%至9%；两次斩击不自动使治疗翻倍。", 110));
}, [
  { item: "非英雄治疗降低和野怪额外伤害", reason: "纯兵野/非英雄分支。" },
], [
  { item: "两次斩击实际攻击时点和治疗折算", reason: "只保存正文数值和窗口，事件层待接线。" },
], "强化攻击伤害、再施放伤害、治疗比例和两次攻击时间分别保存，避免将整段自动乘2。");

define("Zaahen", "W", "厄影回锋", 5, (add, addFormula) => {
  add(levelFrom("Zaahen", "W", "InitialBaseDamage", 5, "initial_damage_base", "第一段基础物理伤害", "INTEGER", "第一段40/60/80/100/120。", 10));
  add(fixed("initial_bonus_ad_ratio", "第一段额外攻击力倍率", "DECIMAL", calcCoefficient("Zaahen", "W", "InitialDamage", 1), "第一段系数0.5×额外攻击力。", 20));
  add(levelFrom("Zaahen", "W", "SecondaryBaseDamage", 5, "secondary_damage_base", "回拉基础物理伤害", "INTEGER", "回拉30/50/70/90/110。", 30));
  add(fixed("secondary_bonus_ad_ratio", "回拉额外攻击力倍率", "DECIMAL", calcCoefficient("Zaahen", "W", "SecondaryDamage", 1), "回拉系数0.3×额外攻击力。", 40));
  add(fixedFrom("Zaahen", "W", "MaximumPullDistance", "maximum_pull_distance", "最大拉拽距离", "INTEGER", "最大拉拽225。", 50));
  add(fixedFrom("Zaahen", "W", "PullSpeed", "pull_speed", "拉拽速度", "INTEGER", "拉拽速度900。", 60));
  add(fixedTime("Zaahen", "W", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "mCastTime=0.5秒，与spellCastTime并列。", 70));
  add(fixedTime("Zaahen", "W", "spellCastTime", "spell_cast_time_ms", "客户端spellCastTime（毫秒）", "spellCastTime=0.25秒，与mCastTime并列。", 80));
  addFormula(formula("initial_physical_damage", "厄影回锋第一段物理伤害", ADD(P("initial_damage_base"), MUL(P("initial_bonus_ad_ratio"), sourceBonusAD())), "第一段=40至120+0.5×额外攻击力。", 90));
  addFormula(formula("secondary_physical_damage", "厄影回锋回拉物理伤害", ADD(P("secondary_damage_base"), MUL(P("secondary_bonus_ad_ratio"), sourceBonusAD())), "回拉=30至110+0.3×额外攻击力。", 100));
}, [
  { item: "额外敌人", reason: "一对一只保留同一敌人的两段命中。" },
], [
  { item: "两段命中时点和拉拽事件", reason: "源数值已保存，事件层待接线。" },
], "W两段同敌伤害、拉距、速度和两个冲突施法时间并列保存；公共冷却只复用。");

define("Zaahen", "E", "赤金突袭", 5, (add, addFormula) => {
  add(levelFrom("Zaahen", "E", "Damage_Base", 5, "inner_damage_base", "内圈基础物理伤害", "INTEGER", "内圈40/60/80/100/120。", 10));
  add(fixed("inner_bonus_ad_ratio", "内圈额外攻击力倍率", "DECIMAL", calcCoefficient("Zaahen", "E", "BaseDamageCalc", 1), "当前BaseDamageCalc系数0.5。", 20));
  add(fixedFrom("Zaahen", "E", "SweetSpotDamageMod", "outer_physical_multiplier", "外圈物理整段倍率", "DECIMAL", "外圈当前树整体×1.5。", 30));
  add(levelFrom("Zaahen", "E", "PercentHPDamage", 5, "outer_target_max_health_ratio", "外圈目标最大生命魔法伤害比例", "DECIMAL", "外圈另加目标最大生命4/4.5/5/5.5/6%，比例单位。", 40, 1));
  add(fixedFrom("Zaahen", "E", "DashDistance", "dash_distance", "冲刺距离", "INTEGER", "冲刺距离350。", 50));
  add(fixedFrom("Zaahen", "E", "DashSpeed", "dash_speed", "冲刺速度", "INTEGER", "冲刺速度900。", 60));
  add(fixedFrom("Zaahen", "E", "MinimumRadius", "inner_radius", "内圈半径", "INTEGER", "内圈半径200。", 70));
  add(fixedFrom("Zaahen", "E", "MaximumRadius", "outer_radius", "外圈半径", "INTEGER", "外圈半径375。", 80));
  add(fixed("dash_stage_duration_ms", "冲刺阶段持续（毫秒）", "INTEGER", toMs(spell("Zaahen", "E").spellTotalTime, "Zaahen/E/spellTotalTime"), "spellTotalTime=0.25秒；spellCastTime=0不表示突进瞬达。", 90));
  addFormula(formula("inner_physical_damage", "赤金突袭内圈物理伤害", ADD(P("inner_damage_base"), MUL(P("inner_bonus_ad_ratio"), sourceBonusAD())), "内圈=40至120+0.5×额外攻击力。", 100));
  addFormula(formula("outer_physical_damage", "赤金突袭外圈物理伤害", MUL(P("outer_physical_multiplier"), ADD(P("inner_damage_base"), MUL(P("inner_bonus_ad_ratio"), sourceBonusAD()))), "外圈物理整段×1.5。", 110));
  addFormula(formula("outer_magic_health_damage", "赤金突袭外圈最大生命魔法伤害", MUL(P("outer_target_max_health_ratio"), targetHP()), "外圈另加目标最大生命4%至6%的魔法伤害，不乘1.5。", 120));
}, [
  { item: "DamageBonusBase、野怪加伤和野怪上限", reason: "当前整树使用SweetSpotDamageMod；兵野专用分支排除。" },
], [
  { item: "突进命中时点和内外圈资格", reason: "保留半径和整段倍率，事件层待接线。" },
], "外圈物理×1.5与额外最大生命魔法段分开，绝不把魔法段一起乘1.5。");

define("Zaahen", "R", "大赦", 3, (add, addFormula, addEffect) => {
  add(levelFrom("Zaahen", "R", "EndDamage", 3, "end_damage_base", "终结基础物理伤害", "INTEGER", "终结伤害250/400/550。", 10));
  add(fixedFrom("Zaahen", "R", "BonusADDamageRatio", "bonus_ad_ratio", "终结额外攻击力倍率", "DECIMAL", "DamageEndCalc系数2×来源额外攻击力。", 20));
  add(fixedFrom("Zaahen", "R", "HealPercent", "actual_damage_heal_ratio", "实际伤害治疗比例", "DECIMAL", "治疗比例33%，按当前敌方英雄合资格实际伤害计算。", 30));
  add(levelFrom("Zaahen", "R", "ArmorPen", 3, "armor_penetration_ratio", "常驻护甲穿透比例", "DECIMAL", "护甲穿透10/20/30%，比例单位。", 40));
  add(fixedFrom("Zaahen", "R", "DamageReduction", "damage_reduction_ratio", "施放期间伤害减免比例", "DECIMAL", "施放期间50%减伤。", 50));
  add(fixedFrom("Zaahen", "R", "DashMaxDistance", "dash_max_distance", "最大升空位移距离", "INTEGER", "最大位移600。", 60));
  add(fixedFrom("Zaahen", "R", "DashSpeed", "dash_speed", "升空速度", "INTEGER", "升空速度2800。", 70));
  add(fixedFrom("Zaahen", "R", "AoESize", "aoe_size", "终结范围", "INTEGER", "范围550。", 80));
  add(runtime("actual_eligible_damage", "当前合资格实际伤害", "DECIMAL", "治疗基准折前/折后未证，运行层提供对当前敌方英雄合资格实际伤害，不设默认。", 90));
  add(fixedTime("Zaahen", "R", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "mCastTime=0.5秒，与spellCastTime=0并列。", 100));
  addFormula(formula("end_physical_damage", "大赦终结物理伤害", ADD(P("end_damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "终结=250/400/550+2×额外攻击力。", 110));
  addFormula(formula("self_healing_from_actual_damage", "大赦自身实际伤害治疗", MUL(P("actual_damage_heal_ratio"), P("actual_eligible_damage")), "治疗=33%×当前敌方英雄合资格实际伤害，不把原始伤害树直接当治疗基准。", 120));
  addEffect(attrEffect("armor_penetration", "大赦常驻护甲穿透", "自身护甲穿透比例；R主动期间减伤和击杀生存链由事件层接线。", "armor_pen_percent", "PARAMETER", "armor_penetration_ratio", null, 20));
}, [
  { item: "击杀/受控本体生存链之外的完整变形", reason: "凝滞复活是P本体生存机制，不构造完整形态。" },
  { item: "兵野分支", reason: "纯非英雄目标分支排除。" },
], [
  { item: "治疗折前折后实际伤害、施放状态和事件时点", reason: "用具名无默认实际伤害输入。" },
], "保留常驻护甲穿透、主动减伤、终结伤害和按实际合资格伤害治疗；两个施法时间字段不任选。");

const order = [
  "belveth_p", "belveth_q", "belveth_w", "belveth_e", "belveth_r",
  "hwei_p", "hwei_q", "hwei_w", "hwei_e", "hwei_r",
  "locke_p", "locke_q", "locke_w", "locke_e", "locke_r",
  "zaahen_p", "zaahen_q", "zaahen_w", "zaahen_e", "zaahen_r",
];
assert(Object.keys(defs).length === 20, "技能槽不是20个");
for (const key of order) {
  assert(defs[key] && defs[key].write && Object.keys(defs[key].write).join(",") === "parameters,formulas,effects,processes,internalStates,triggerRules", "六类组成缺失：" + key);
  for (const parameter of defs[key].write.parameters) {
    if (parameter.valueMode === "FIXED") assert(parameter.fixedValue !== null && parameter.fixedValue !== undefined && Number.isFinite(Number(parameter.fixedValue)), "固定参数无有限值：" + key + "/" + parameter.parameterKey);
    if (parameter.valueMode === "RUNTIME_INPUT") assert(parameter.fixedValue === null && parameter.levelValues === null, "运行输入带默认：" + key + "/" + parameter.parameterKey);
    if (parameter.valueMode === "SKILL_LEVEL" || parameter.valueMode === "CHARACTER_LEVEL") assert(parameter.levelValues && Object.keys(parameter.levelValues).length > 0, "等级参数缺少数组：" + key + "/" + parameter.parameterKey);
    if (parameter.parameterKey.endsWith("_ms")) for (const value of Object.values(parameter.levelValues || { fixed: parameter.fixedValue })) assert(Number.isInteger(Number(value)) && Number(value) >= 0, "毫秒值不是整数：" + key + "/" + parameter.parameterKey);
  }
  for (const f of defs[key].write.formulas) {
    const visit = node => {
      assert(node && typeof node === "object", "公式节点为空：" + key + "/" + f.formulaKey);
      if (node.nodeType === "OPERATION") {
        assert(Array.isArray(node.operands) && node.operands.length === 2, "公式不是二元运算：" + key + "/" + f.formulaKey);
        node.operands.forEach(visit);
      }
    };
    visit(f.expression);
  }
}

const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const routes = { parameters: "parameters", formulas: "formulas", effects: "effects", processes: "processes", internalStates: "internal-states", triggerRules: "trigger-rules" };
const keyNames = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" };
const writes = order.flatMap(skillKey => kinds.flatMap(kind => defs[skillKey].write[kind].map(body => ({ skillKey, kind, body }))));
const requestCounts = Object.fromEntries(kinds.map(kind => [kind, writes.filter(item => item.kind === kind).length]));
const requests = writes.map((item, index) => {
  const stableKey = item.body[keyNames[item.kind]];
  assert(stableKey, "缺少稳定键：" + item.skillKey + "/" + item.kind);
  return {
    sequence: index + 1,
    operation: "POST",
    method: "POST",
    route: "/skills/" + item.skillKey + "/" + routes[item.kind],
    detailRoute: "/skills/" + item.skillKey + "/" + routes[item.kind] + "/" + stableKey,
    skillKey: item.skillKey,
    kind: item.kind,
    stableKey,
    status: "仅意图，未调用",
    body: clone(item.body),
  };
});
const counts = {
  newParameters: requestCounts.parameters,
  newFormulas: requestCounts.formulas,
  newEffects: requestCounts.effects,
  newProcesses: requestCounts.processes,
  newInternalStates: requestCounts.internalStates,
  newTriggerRules: requestCounts.triggerRules,
  newTotal: requests.length,
  reusedPublicParameters: reuseList.length,
  plannedTotalIncludingReused: requests.length + reuseList.length,
  protectedCurrentCompositionLists: order.length * 6,
};

const generatedAt = new Date().toISOString();
const inputHashes = {
  sourceBindingSha256: shaFile(bindingFile),
  sourceRangeSha256: shaFile(rangeFile),
  sourceAuditSha256: shaFile(auditFile),
  protectionSnapshotSha256: shaFile(protectionFile),
  publicReuseSha256: shaFile(reuseFile),
  inputVersionSha256: shaFile(versionFile),
  attributeNarrowSha256: shaFile(attributeFile),
  payloadSampleSha256: shaFile(payloadFile),
  supplementSha256: shaFile(supplementFile),
  cursorConclusionSha256: shaFile(cursorReviewFile),
  cursorAuditSha256: shaFile(cursorAuditFile),
};
const meta = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "候选已冻结，等待主负责人保存；未调用业务接口",
  gameId: "lol",
  apiBase: API_BASE,
  sourceVersion: { clientVersion: binding.clientVersion, officialVersion: binding.officialVersion, build: heroes.Belveth.source.client.contentVersion },
  sourcePolicy: "固定客户端16.17、官方16.17.1、根绑定正文、完整计算树和彗九种技法补充；明确值入候选，未知属性/曲线/阶段/事件使用有名无默认输入。",
  scope: "卑尔维斯、彗、洛克、亚恒20个技能槽；一对一保留本体、唯一敌方英雄、自身强化、同敌重复命中和战前层数。真实形态、鱼、犬狼式自主单位、额外目标和兵野分支按范围排除。",
  ...inputHashes,
  inputGETs: protection.GETs,
  publicReuseCount: reuseList.length,
  apiCalls: 0,
  businessWrites: 0,
  noBusinessWrites: true,
  tokenStored: false,
  candidateSha256: null,
  sourceReview,
  inputPackage: ".agents/artifacts/hero46-root-entry-20260910",
};
const candidate = {
  meta,
  skills: Object.fromEntries(order.map(key => [key, defs[key]])),
  order,
  reusedPublicParameters: reuseList.map(item => ({ ...item, post: false, note: "保护对象只读复用，不在本批覆盖。" })),
  reusedExistingParameters: reuseList.map(item => ({ ...item, post: false, note: "现有公共参数按冻结GET复用。" })),
  counts,
  apiWrites: 0,
  sourceFiles,
  sourceNotes: [
    "固定客户端原文和官方中英文资料均按输入版本散列校验。",
    "根绑定正文和逐槽说明优先于通用旧值；公共参数仅复用不覆盖。",
    "彗九技法保存在Q/W/E组内，眼眸保留探测追踪控制链，不建立独立攻击召唤主体。",
    "比例属性的效果结果使用attribute_flat_add；未知实际值使用RUNTIME_INPUT且没有默认。",
  ],
  protectedObjects: {
    snapshot: "输入包/参考资料/当前20槽保护快照.json",
    snapshotSha256: inputHashes.protectionSnapshotSha256,
    inputGETs: protection.GETs,
    requestCount: protection.requests.length,
    routes: protectedRouteHashes,
    publicReuse: reuseList.map(item => ({ ...item, post: false })),
    note: "20个主体、六类当前组成、代表图、角色关系、字典和26公共参数均为保护对象；候选计划只新增本批组成。",
  },
  revision: REVISION,
};
const candidateBytesFinal = jsonBytes(candidate);
const finalCandidateHash = sha256(candidateBytesFinal);

const scope = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "第46批来源与范围已冻结；未调用业务接口",
  sourceBindingSha256: inputHashes.sourceBindingSha256,
  sourceRangeSha256: inputHashes.sourceRangeSha256,
  sourceAuditSha256: inputHashes.sourceAuditSha256,
  cursorConclusionSha256: inputHashes.cursorConclusionSha256,
  sourceReviewVerdict: sourceReview.verdict,
  inputGETs: protection.GETs,
  publicReuseCount: reuseList.length,
  scopeDecisions: {
    belveth: "普通P/Q/W/E及R普通被动保留；真正形态、虚空鱼和主动吞噬链跳过。",
    hwei: "P/Q/W/E/R主体保留；九技法进入既有Q/W/E组，菜单不消费，组共享冷却/消耗分开；眼眸只保留控制链。",
    locke: "法器作为伤害/阈值载体；P/Q/W/E/R本体与唯一敌人保留，官方E冷却不静默补入。",
    zaahen: "P/Q/W/E/R本体保留；凝滞复活是本体生存，不构造形态；比例AD不自引用。",
  },
  skills: Object.fromEntries(order.map(key => [key, {
    recordableParameters: defs[key].write.parameters.map(item => item.parameterKey),
    recordableFormulas: defs[key].write.formulas.map(item => item.formulaKey),
    recordableEffects: defs[key].write.effects.map(item => item.effectKey),
    recordableProcesses: [],
    recordableInternalStates: [],
    recordableTriggerRules: [],
    excluded: clone(defs[key].excluded),
    pending: clone(defs[key].pending),
    currentSubjectProtected: defs[key].protectedExisting.subject,
  }])),
  noApiCalls: true,
  apiWrites: 0,
};
const plan = {
  generatedAt,
  status: "仅写入意图，未调用业务接口",
  batch: BATCH,
  revision: REVISION,
  apiBase: API_BASE,
  sourceVersion: clone(meta.sourceVersion),
  candidateSha256: finalCandidateHash,
  sourceBindingSha256: inputHashes.sourceBindingSha256,
  sourceRangeSha256: inputHashes.sourceRangeSha256,
  sourceAuditSha256: inputHashes.sourceAuditSha256,
  protectionSnapshotSha256: inputHashes.protectionSnapshotSha256,
  publicReuseSha256: inputHashes.publicReuseSha256,
  requestCount: requests.length,
  counts: clone(counts),
  reusedPublicParameters: reuseList.map(item => ({ ...item, post: false })),
  protectedRoutes: protectedRouteHashes,
  protectedSummary: { inputGETs: protection.GETs, inputRequestCount: protection.requests.length, note: "写入前逐条GET保护；本计划不覆盖已有主体或组成。" },
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
  status: "独立来源值摘要；未调用业务接口",
  sourceBindingSha256: inputHashes.sourceBindingSha256,
  sourceAuditSha256: inputHashes.sourceAuditSha256,
  supplementSha256: inputHashes.supplementSha256,
  sourceValues: Object.fromEntries(order.map(key => {
    const source = defs[key].source;
    return [key, {
      hero: source.hero,
      slot: source.slot,
      rootPath: source.rootPath,
      spellPath: source.spellPath,
      currentText: clone(source.currentBoundText),
      rawDataValues: clone(source.raw.dataValues),
      rawCalculations: clone(source.raw.calculations),
      rawFields: clone(source.raw.fields),
      techniqueSources: clone(source.techniqueSources || []),
      selectedParameterKeys: defs[key].write.parameters.map(item => item.parameterKey),
      selectedFormulaKeys: defs[key].write.formulas.map(item => item.formulaKey),
      selectedEffectKeys: defs[key].write.effects.map(item => item.effectKey),
      sourceTextConsumers: Object.values(source.currentBoundText || {}).map(item => item?.text || "").join("\n"),
    }];
  })),
  excludedSourceNames: {
    belveth_p: ["MonsterStacks", "ARAMBonusStacks", "BrawlBonusStacks", "SheenNumberOfAttacks", "AdditionalBonusAtThisLevel"],
    belveth_q: ["MaxDistanceOverWalls", "RiftDashSpeed", "MonsterMod", "MinonMod", "BaseHealthSteal"],
    belveth_w: ["mStat省略属性的枚举"],
    belveth_e: ["AttackSpeedMult", "MonsterMod", "MissingHealthMult"],
    belveth_r: ["真正形态、主动爆炸和虚空鱼字段"],
    hwei_p: ["InkTimeout", "不同减速递减规则"],
    hwei_q: ["MaxBonusDamage", "MinionDamageMod", "JungleDamageRatio", "菜单与组外消耗"],
    hwei_w: ["AllyMod", "ToolTipAllyMod", "DamageDuration以外的匿名回蓝+3树"],
    hwei_e: ["纯视野效果", "九技法独立主体"],
    hwei_r: ["MaxDamageHelper"],
    locke_p: ["被动0施法字段"],
    locke_q: ["QMissileMinionMod", "QMarkMinionMod", "回蓝未给值"],
    locke_w: ["源字段Mana/ManaValues冲突只复用保护值", "治疗完整交互"],
    locke_e: ["官方10秒冷却未静默写入"],
    locke_r: ["AbilityHastePerStack", "其他敌人续标记"],
    zaahen_p: ["PercentBonusAD旧常量", "cooldownTime=100"],
    zaahen_q: ["MinionHealPercent", "MonsterDamagePercent"],
    zaahen_w: ["多敌目标"],
    zaahen_e: ["DamageBonusBase", "MonsterDamageBonus", "MonsterDamageCap"],
    zaahen_r: ["spellCastTime=0作为唯一施法时间"],
  },
  noApiCalls: true,
  apiWrites: 0,
};
const sourceValuesBytes = jsonBytes(sourceValues);
const sourceValuesSha256 = sha256(sourceValuesBytes);
const hashes = { generatedAt, batch: BATCH, revision: REVISION, candidateSha256: finalCandidateHash, planSha256, sourceValuesSha256, sourceScopeSha256: sha256(jsonBytes(scope)), ...inputHashes };
const version = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "候选冻结，未调用业务接口",
  candidateSha256: finalCandidateHash,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256: hashes.sourceScopeSha256,
  ...inputHashes,
  counts: clone(counts),
  requestCount: requests.length,
  sourceReview: clone(sourceReview),
  sourceMath: "独立数学核算.mjs",
  sourceMathStatus: "待执行",
  apiCalls: 0,
  businessWrites: 0,
  noBusinessWrites: true,
};
const sourceHashSummary = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  sourceFiles,
  artifactHashes: hashes,
  sourceReview: clone(sourceReview),
  apiCalls: 0,
  businessWrites: 0,
};
const experience = [
  "# 第四十六批候选体验记录",
  "",
  "20个技能槽均有固定客户端16.17、官方16.17.1、当前中文绑定正文和主体保护快照。Cursor来源复核为READY，3134个事件、63个唯一工具、26个冻结输入散列一致，业务写入0，Git零变化。",
  "",
  "候选只计划新增参数、公式和必要效果；冻结的26个公共冷却/法力参数只读复用。主体、已有六类组成、代表图、角色关系和字典均列为保护对象。",
  "",
  "彗九种技法沿用Q/W/E三组，菜单选择不生成额外冷却或消耗；眼眸仅保存探测、锁定和追踪飞弹控制伤害。卑尔维斯真实形态与虚空鱼、洛克法器独立攻击、亚恒完整形态均按范围处理。",
  "",
  "未知角色等级曲线、血量曲线、属性枚举、折前折后阶段和事件时点使用无默认运行输入；固定值均为有限数字，时间参数均为整数毫秒。比例属性结果统一使用attribute_flat_add。",
  "",
  "候选、请求计划和来源摘要是静态设计证据；未执行业务接口、数据库、浏览器或战斗运行，独立数学脚本另行检查公式、缺值拒绝、效果最终倍率和单位。",
].join("\n");
const readme = [
  "# 第四十六批候选",
  "",
  "本目录保存卑尔维斯、彗、洛克、亚恒20个技能槽的静态候选。来源固定客户端16.17、官方16.17.1、根绑定正文、逐槽核对说明和彗九种技法补充。",
  "",
  "Cursor来源复核为READY（3134事件、63个唯一工具、26项输入、业务写入0、Git零变化）。候选只新增本批组成，198次GET保护快照和26个公共参数只读复用。",
  "",
  "彗九技法仍保存在Q/W/E三槽内；菜单不消费，组共享冷却和法力分开。未知曲线、实际属性、命中资格与时序均使用无默认运行输入；比例属性效果使用attribute_flat_add。",
  "",
  "入口文件：完整候选.json、请求计划.json、来源值摘要.json、来源与范围.json、来源哈希汇总.json、候选版本.json、体验报告.md、独立数学报告.json。",
  "",
  "候选和计划没有调用业务接口，不能代替实际保存、页面接线或战斗运行。",
].join("\n");
const artifacts = {
  "完整候选.json": candidateBytesFinal,
  "请求计划.json": planBytes,
  "来源值摘要.json": sourceValuesBytes,
  "来源与范围.json": jsonBytes(scope),
  "来源哈希汇总.json": jsonBytes(sourceHashSummary),
  "候选版本.json": jsonBytes(version),
  "README.md": Buffer.from(readme, "utf8"),
  "体验报告.md": Buffer.from(experience, "utf8"),
  "来源冻结通知.json": jsonBytes({
    batch: BATCH,
    revision: REVISION,
    candidateSha256: finalCandidateHash,
    planSha256,
    sourceValuesSha256,
    sourceScopeSha256: hashes.sourceScopeSha256,
    counts,
    requestCount: requests.length,
    sourceReview: { verdict: sourceReview.verdict, events: sourceReview.events, uniqueTools: sourceReview.uniqueTools, frozenInputs: sourceReview.frozenInputs },
    apiCalls: 0,
    businessWrites: 0,
    status: "来源和候选已冻结，等待主负责人保存；未调用业务接口",
  }),
};
for (const [name, bytes] of Object.entries(artifacts)) writeBytes(path.join(ROOT, name), bytes);
fs.mkdirSync(DURABLE, { recursive: true });
for (const [name, bytes] of Object.entries(artifacts)) {
  writeBytes(path.join(DURABLE, name), bytes);
  assert(shaFile(path.join(ROOT, name)) === shaFile(path.join(DURABLE, name)), "持久目录字节不一致：" + name);
}
console.log(JSON.stringify({
  batch: BATCH,
  revision: REVISION,
  sourceReview: { verdict: sourceReview.verdict, events: sourceReview.events, uniqueTools: sourceReview.uniqueTools, frozenInputs: sourceReview.frozenInputs },
  counts,
  requestCount: requests.length,
  candidateSha256: finalCandidateHash,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256: hashes.sourceScopeSha256,
  publicReuse: reuseList.length,
  apiCalls: 0,
  businessWrites: 0,
  durable: DURABLE,
}, null, 2));
