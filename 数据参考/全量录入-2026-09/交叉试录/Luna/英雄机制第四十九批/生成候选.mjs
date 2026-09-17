import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero49-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十九批");
const CURSOR = path.resolve(ROOT, "..", "hero49-cursor-review-run-20260910");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "英雄机制第四十九批";
const REVISION = "hero49-source-v1-luna-candidate";

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
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const finite = (value, label) => {
  assert(typeof value === "number" && Number.isFinite(value), "数值不是有限数字：" + label + "/" + value);
  return Number(Number(value).toFixed(9));
};
const integer = (value, label) => {
  const number = finite(value, label);
  assert(Number.isInteger(number), "数值不是整数：" + label + "/" + number);
  return number;
};
const toMs = (seconds, label) => {
  const value = Number(seconds) * 1000;
  const rounded = Math.round(value);
  assert(Number.isFinite(value) && rounded >= 0 && Math.abs(value - rounded) < 0.1, "时间不是可解释的整数毫秒：" + label + "/" + seconds);
  return rounded;
};
const ratio = value => finite(Number(value) / 100, "比例");
const norm = value => finite(value, "原始数值");
const slug = value => String(value).replaceAll("/", "_").replaceAll("\\", "_");

const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const summaryFile = path.join(INPUT, "主负责人源值摘要.json");
const versionFile = path.join(INPUT, "输入版本.json");
const finalScopeFile = path.join(INPUT, "主负责人最终范围与核对说明.md");
const oldScopeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const inputReadmeFile = path.join(INPUT, "README.md");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const chineseTextFile = path.join(INPUT, "参考资料", "当前中文文本.json");
const sourceIndexFile = path.join(INPUT, "参考资料", "技能来源索引.json");
const getAuditFile = path.join(INPUT, "参考资料", "GET审计摘要.json");
const cursorReviewFile = path.join(CURSOR, "Cursor来源复核结论.md");
const cursorAuditFile = path.join(CURSOR, "主负责人执行审计.json");
const cursorSummaryFile = path.join(CURSOR, "summary.json");
const cursorPreflightFile = path.join(CURSOR, "preflight.md");
const cursorEventsFile = path.join(CURSOR, "events.jsonl");

const binding = readJson(bindingFile);
const sourceSummary = readJson(summaryFile);
const inputVersion = readJson(versionFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const attributes = new Set((protection.dictionaries?.["/attributes"]?.items || []).map(item => item.attributeKey));
const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const skillsByKey = Object.fromEntries(binding.heroes.flatMap(hero => hero.skills.map(skill => [skill.skillKey, { hero, skill }])));
const summaryByKey = Object.fromEntries(sourceSummary.skills.map(skill => [skill.skillKey, skill]));
const subjectByKey = Object.fromEntries(Object.entries(protection.summary || {}).map(([key, value]) => [key, value.subject || null]));
const reuseSet = new Set(reuseList.map(item => item.skillKey + "/" + item.parameterKey));
const protectedRoutes = protection.requests.map(item => ({
  route: item.route,
  status: item.status,
  dataSha256: sha256(JSON.stringify(item.data)),
}));
const audit = readJson(cursorAuditFile);
assert(audit.readonlyAuditPassed === true, "Cursor只读审计未通过");
assert(audit.resultStatus === "finished" && audit.events === 2946 && audit.uniqueTools === 79 && audit.inputsChecked === 24, "Cursor审计数字不符");
assert(audit.apiWrites === 0 && Array.isArray(audit.gitDelta) && audit.gitDelta.length === 0, "Cursor审计存在业务写入或Git变化");
const sourceReview = {
  verdict: "READY",
  reviewedPlanRev: audit.reviewedPlanRev,
  runId: audit.runId,
  requestId: audit.requestId,
  events: audit.events,
  uniqueTools: audit.uniqueTools,
  toolNames: clone(audit.toolNames),
  frozenInputs: audit.inputsChecked,
  apiWrites: audit.apiWrites,
  gitChanges: audit.gitDelta.length,
  conclusionFile: ".agents/artifacts/hero49-cursor-review-run-20260910/Cursor来源复核结论.md",
  conclusionSha256: shaFile(cursorReviewFile),
  auditFile: ".agents/artifacts/hero49-cursor-review-run-20260910/主负责人执行审计.json",
  auditSha256: shaFile(cursorAuditFile),
  summaryFile: ".agents/artifacts/hero49-cursor-review-run-20260910/summary.json",
  summarySha256: shaFile(cursorSummaryFile),
  preflightFile: ".agents/artifacts/hero49-cursor-review-run-20260910/preflight.md",
  eventsFile: ".agents/artifacts/hero49-cursor-review-run-20260910/events.jsonl",
  eventsSha256: shaFile(cursorEventsFile),
  currentFinalScopeSha256: shaFile(finalScopeFile),
  auditRecordedFinalScopeSha256: (audit.inputs || []).find(item => item.path === "主负责人最终范围与核对说明.md")?.actualSha256 || null,
  note: "Cursor只读复核来源；READY不代表候选已保存、页面已接线或战斗已通过。最终范围文件在复核后有两条非阻塞文字更正，候选按当前字节读取。",
};

const spellAt = (heroId, slot) => {
  const item = skillsByKey[heroId.toLowerCase() + "_" + slot.toLowerCase()];
  assert(item, "缺少源技能：" + heroId + "/" + slot);
  assert(item.skill.sourceObject && item.skill.sourceObject.mSpell, "缺少sourceObject.mSpell：" + heroId + "/" + slot);
  return item.skill.sourceObject.mSpell;
};
const skillMeta = (heroId, slot) => {
  const item = skillsByKey[heroId.toLowerCase() + "_" + slot.toLowerCase()];
  assert(item, "缺少源技能：" + heroId + "/" + slot);
  return item.skill;
};
const summaryAt = (heroId, slot) => summaryByKey[heroId.toLowerCase() + "_" + slot.toLowerCase()];
const dataRow = (heroId, slot, name) => {
  const row = (spellAt(heroId, slot).DataValues || []).find(item => item.name === name);
  assert(row && Array.isArray(row.values), "缺少可用DataValues：" + heroId + "/" + slot + "/" + name);
  return row.values;
};
const dataAt = (heroId, slot, name, index = 1) => {
  const value = dataRow(heroId, slot, name)[index];
  assert(value !== undefined, "DataValues索引不存在：" + heroId + "/" + slot + "/" + name + "/" + index);
  return norm(value);
};
const levelValuesFromData = (heroId, slot, name, maxLevel, transform = value => value) => Object.fromEntries(
  Array.from({ length: maxLevel }, (_, index) => {
    const value = transform(dataAt(heroId, slot, name, index + 1));
    return [String(index + 1), finite(value, heroId + "/" + slot + "/" + name + "/level" + (index + 1))];
  }),
);
const field = (heroId, slot, name) => spellAt(heroId, slot)[name];
const fieldArray = (heroId, slot, name) => {
  const value = field(heroId, slot, name);
  const values = Array.isArray(value) ? value : value && Array.isArray(value.values) ? value.values : null;
  assert(values, "缺少数组字段：" + heroId + "/" + slot + "/" + name);
  return values;
};
const fieldLevels = (heroId, slot, name, maxLevel, transform = value => value) => Object.fromEntries(
  Array.from({ length: maxLevel }, (_, index) => {
    const value = transform(fieldArray(heroId, slot, name)[index + 1]);
    return [String(index + 1), finite(value, heroId + "/" + slot + "/" + name + "/level" + (index + 1))];
  }),
);
const official = (heroId, slot, language = "zh") => {
  const dir = language === "en" ? "官方英文" : "官方中文";
  const file = path.join(INPUT, "参考资料", dir, heroId + ".json");
  const root = readJson(file).data[heroId];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};
const officialLevels = (heroId, slot, fieldName, maxLevel, transform = value => value) => {
  const values = official(heroId, slot)[fieldName];
  assert(Array.isArray(values) && values.length >= maxLevel, "官方数组缺失：" + heroId + "/" + slot + "/" + fieldName);
  return Object.fromEntries(Array.from({ length: maxLevel }, (_, index) => [String(index + 1), finite(transform(values[index]), heroId + "/" + slot + "/" + fieldName + "/rank" + (index + 1))]));
};
const calc = (heroId, slot, name) => {
  const value = (spellAt(heroId, slot).mSpellCalculations || {})[name];
  assert(value, "缺少计算树：" + heroId + "/" + slot + "/" + name);
  return value;
};
const calcPart = (heroId, slot, name, index = 0) => {
  const part = (calc(heroId, slot, name).mFormulaParts || [])[index];
  assert(part, "缺少计算树分支：" + heroId + "/" + slot + "/" + name + "/" + index);
  return part;
};
const coefficient = (heroId, slot, name, index = 1) => {
  const value = calcPart(heroId, slot, name, index).mCoefficient;
  return finite(value, heroId + "/" + slot + "/" + name + "/mCoefficient");
};
const multiplierNumber = (heroId, slot, name) => {
  const value = calc(heroId, slot, name).mMultiplier?.mNumber;
  return finite(value, heroId + "/" + slot + "/" + name + "/mMultiplier");
};
const fixedTimeFromField = (heroId, slot, name, label) => {
  const value = field(heroId, slot, name);
  assert(typeof value === "number", "时间字段不是单值：" + heroId + "/" + slot + "/" + name);
  return toMs(value, label || heroId + "/" + slot + "/" + name);
};
const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const meta = skillMeta(heroId, slot);
  const sp = meta.sourceObject.mSpell;
  const source = {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    slot,
    skillKey: meta.skillKey,
    resourceType: hero.resourceType,
    rootPath: hero.source.rootPath,
    spellPath: meta.binding,
    sourceObjectField: "sourceObject",
    sourceObjectPath: meta.sourceObject.objectPath,
    sourceObjectName: meta.sourceObject.ObjectName,
    clientFile: "参考资料/客户端原文/" + heroId + ".json.gz",
    clientSha256: hero.source.client.sha256,
    clientCompressedSha256: shaFile(path.join(INPUT, "参考资料", "客户端原文", heroId + ".json.gz")),
    clientBuild: hero.source.client.contentVersion,
    officialZhFile: "参考资料/官方中文/" + heroId + ".json",
    officialZhSha256: shaFile(path.join(INPUT, "参考资料", "官方中文", heroId + ".json")),
    officialEnFile: "参考资料/官方英文/" + heroId + ".json",
    officialEnSha256: shaFile(path.join(INPUT, "参考资料", "官方英文", heroId + ".json")),
    currentBoundText: clone(meta.currentTexts),
    sourceSummary: clone(summaryAt(heroId, slot)),
    raw: {
      dataValues: Object.fromEntries((sp.DataValues || []).map(row => [row.name, row.values === undefined ? null : clone(row.values)])),
      calculations: clone(sp.mSpellCalculations || {}),
      fields: Object.fromEntries([
        "mCastTime", "spellCastTime", "spellTotalTime", "mChannelDuration",
        "cooldownTime", "Cooldown", "mana", "manaValues", "castRange",
        "castRangeValues", "mMaxAmmo", "mAmmoRechargeTime",
      ].map(key => [key, sp[key] === undefined ? null : clone(sp[key])])),
    },
    officialEvidence: { zh: clone(official(heroId, slot, "zh")), en: clone(official(heroId, slot, "en")) },
    currentTextPath: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot + "/currentTexts",
  };
  return source;
};

const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => {
  assert(attributes.has(attributeKey), "属性字典中不存在：" + attributeKey);
  return { nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind };
};
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);
const sourceTotalAD = () => A("SOURCE", "attack_damage", "TOTAL");
const sourceBonusAD = () => A("SOURCE", "attack_damage", "BONUS");
const sourceAP = () => A("SOURCE", "ability_power", "TOTAL");
const sourceHP = () => A("SOURCE", "hp", "TOTAL");
const sourceBonusHP = () => A("SOURCE", "hp", "BONUS");
const targetHP = () => A("TARGET", "hp", "TOTAL");
const SD = (dataName, transform = 1) => ({ nodeType: "SOURCE_DATA", dataName, transform });
const SA = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "SOURCE_ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const SR = runtimeKey => ({ nodeType: "SOURCE_RUNTIME", runtimeKey });
const SC = (value, sourceLabel) => ({ nodeType: "SOURCE_CONSTANT", value: finite(value, sourceLabel || "sourceConstant"), sourceLabel: sourceLabel || null });
const f = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });
const ev = (sourceCalculation, sourceRule, damageType, note = "") => ({ sourceCalculation, sourceRule, damageType, note, sourceObjectField: "sourceObject" });

const fixed = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "FIXED", fixedValue: valueType === "INTEGER" ? integer(fixedValue, parameterKey) : finite(fixedValue, parameterKey), levelValues: null, description, sortOrder,
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
const attrEffect = (effectKey, name, description, attributeKey, valueKind, valueKey, durationKey, order = 20) => {
  assert(attributes.has(attributeKey), "效果属性不存在：" + attributeKey);
  return {
    effectKey, name, description, sortOrder: order, lifecycle: lifecycle(durationKey),
    results: [{
      resultKey: "attribute", name, resultType: "ATTRIBUTE_CHANGE", target: "SOURCE",
      description: "仅定义自身属性变化，触发资格和时点由事件层接线。",
      sortOrder: 10, lifecycleBehavior: resultLifecycle(), spellShieldBlockScope: null,
      valueRule: valueRule(valueKind, valueKey),
      detail: { attributeKey, operation: "INCREASE", modifierZoneKey: "attribute_flat_add" },
    }],
  };
};
const shieldEffect = (effectKey, name, description, formulaKey, durationKey, order = 20) => ({
  effectKey, name, description, sortOrder: order, lifecycle: lifecycle(durationKey),
  results: [{
    resultKey: "shield", name, resultType: "NORMAL_SHIELD", target: "SOURCE",
    description: "普通护盾；构建和消失时点由事件层接线。",
    sortOrder: 10, lifecycleBehavior: resultLifecycle(), spellShieldBlockScope: null,
    valueRule: valueRule("FORMULA", formulaKey),
    detail: { absorbedDamageTypeKey: null, decayMode: "NONE" },
  }],
});

const defs = {};
const order = [];
const define = (heroId, slot, displayName, maxLevel, build, excluded, pending, proofNote, experience) => {
  const skillKey = heroId.toLowerCase() + "_" + slot.toLowerCase();
  const write = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  const formulaEvidence = {};
  const add = item => {
    if (!item) return;
    if (reuseSet.has(skillKey + "/" + item.parameterKey)) return;
    assert(!write.parameters.some(value => value.parameterKey === item.parameterKey), "重复参数：" + skillKey + "/" + item.parameterKey);
    write.parameters.push(item);
  };
  const addFormula = (item, evidence) => {
    assert(!write.formulas.some(value => value.formulaKey === item.formulaKey), "重复公式：" + skillKey + "/" + item.formulaKey);
    write.formulas.push(item);
    formulaEvidence[item.formulaKey] = {
      ...(evidence || {}),
      sourceCalculation: evidence?.sourceCalculation || null,
      sourceObjectField: "sourceObject",
      sourceObjectPath: skillMeta(heroId, slot).sourceObject.objectPath,
    };
  };
  const addEffect = item => {
    assert(!write.effects.some(value => value.effectKey === item.effectKey), "重复效果：" + skillKey + "/" + item.effectKey);
    write.effects.push(item);
  };
  build(add, addFormula, addEffect);
  const source = sourceFor(heroId, slot);
  order.push(skillKey);
  defs[skillKey] = {
    skillKey,
    name: heroes[heroId].name + "·" + displayName,
    maxLevel,
    source,
    write,
    formulaEvidence,
    protectedExisting: {
      subject: Object.prototype.hasOwnProperty.call(subjectByKey, skillKey),
      compositionLists: true,
      protectionSnapshot: ".agents/artifacts/hero49-root-entry-20260910/参考资料/当前20槽保护快照.json",
    },
    excluded: excluded || [],
    pending: pending || [],
    proofs: [
      { type: "root-bound-source", path: ".agents/artifacts/hero49-root-entry-20260910/来源绑定与当前文本.json -> " + heroId + "/" + slot + "/sourceObject" },
      { type: "fixed-source-version", client: binding.clientVersion, official: binding.officialVersion, build: heroes[heroId].source.client.contentVersion },
      { type: "cursor-source-review", runId: sourceReview.runId, verdict: sourceReview.verdict, events: sourceReview.events, uniqueTools: sourceReview.uniqueTools },
    ],
    proofNote: proofNote,
    experience: experience || "本槽采用固定来源和当前范围；未知资格、曲线或时点保留为无默认输入。",
    currentSubject: clone(subjectByKey[skillKey] || null),
  };
};
const dataParam = (heroId, slot, dataName, key, name, valueType, description, sortOrder, transform = value => value) => skill(key, name, valueType, levelValuesFromData(heroId, slot, dataName, summaryAt(heroId, slot).officialMaxRank, transform), description, sortOrder);
const dataParamMax = (heroId, slot, dataName, key, name, valueType, maxLevel, description, sortOrder, transform = value => value) => skill(key, name, valueType, levelValuesFromData(heroId, slot, dataName, maxLevel, transform), description, sortOrder);
const fixedData = (heroId, slot, dataName, key, name, valueType, description, sortOrder, index = 1, transform = value => value) => {
  const value = transform(dataAt(heroId, slot, dataName, index));
  return fixed(key, name, valueType, value, description, sortOrder);
};
const fixedField = (heroId, slot, fieldName, key, name, valueType, description, sortOrder, transform = value => value) => {
  const value = transform(field(heroId, slot, fieldName));
  return fixed(key, name, valueType, value, description, sortOrder);
};
const fixedMsField = (heroId, slot, fieldName, key, name, description, sortOrder) =>
  fixed(key, name, "INTEGER", fixedTimeFromField(heroId, slot, fieldName), description, sortOrder);
const publicKey = (skillKey, parameterKey) => reuseSet.has(skillKey + "/" + parameterKey);

// 纳尔
define("Gnar", "P", "狂怒基因", 1, (add, addFormula, addEffect) => {
  const ms = calcPart("Gnar", "P", "TotalMS");
  const as = calcPart("Gnar", "P", "TotalAS");
  const rangePart = calcPart("Gnar", "P", "TotalAttackRange");
  add(fixed("move_speed_initial_bonus_per_level", "移速初始每级增量", "DECIMAL", ms.mInitialBonusPerLevel, "TotalMS源树的初始每级增量；1级值和16级断点当级未证，不补完整角色曲线。", 10));
  add(fixed("move_speed_breakpoint_level", "移速断点等级", "INTEGER", ms.mBreakpoints[0].mLevel, "TotalMS源树的断点等级。", 20));
  add(fixed("move_speed_bonus_at_and_after_breakpoint", "断点后每级移速增量", "DECIMAL", ms.mBreakpoints[0].mBonusPerLevelAtAndAfter, "TotalMS源树断点后的每级增量。", 30));
  add(fixed("attack_speed_start_ratio", "小型攻速比例起点", "DECIMAL", as.mStartValue, "TotalAS角色等级起点，比例属性；不当作完整18级数组。", 40));
  add(fixed("attack_speed_end_ratio", "小型攻速比例终点", "DECIMAL", as.mEndValue, "TotalAS角色等级终点，比例属性；不当作完整18级数组。", 50));
  add(fixed("attack_range_end_bonus", "小型射程计算终点", "INTEGER", rangePart.mEndValue, "TotalAttackRange只有终点100，起点省略。", 60));
  add(runtime("actual_small_move_speed_bonus", "当前小型实际移速增量", "DECIMAL", "TotalMS缺少1级值和完整断点求值，运行层提供当前实际增量，不设默认。", 70));
  add(runtime("actual_small_attack_speed_ratio", "当前小型实际攻速比例", "DECIMAL", "TotalAS带角色成长修正，运行层提供实际比例；1表示100%，不设默认。", 80));
  add(runtime("actual_small_attack_range_bonus", "当前小型实际射程增量", "DECIMAL", "TotalAttackRange只有终点且起点省略，运行层提供实际增量，不设默认。", 90));
  addFormula(f("small_move_speed_bonus", "小型纳尔实际移速增量", P("actual_small_move_speed_bonus"), "保留TotalMS的实际输入，不猜1级和断点当级。", 10), ev("TotalMS", SR("actual_small_move_speed_bonus"), "ATTRIBUTE", "未知角色等级曲线"));
  addFormula(f("small_attack_speed_bonus", "小型纳尔实际攻速比例", P("actual_small_attack_speed_ratio"), "保留TotalAS的实际比例输入。", 20), ev("TotalAS", SR("actual_small_attack_speed_ratio"), "ATTRIBUTE", "未知角色等级曲线"));
  addFormula(f("small_attack_range_bonus", "小型纳尔实际射程增量", P("actual_small_attack_range_bonus"), "保留TotalAttackRange的实际输入。", 30), ev("TotalAttackRange", SR("actual_small_attack_range_bonus"), "ATTRIBUTE", "源树仅有终点"));
  addEffect(attrEffect("small_move_speed", "小型纳尔移速", "小型本体固定移速增量；变形资格和实际曲线由事件层接线。", "move_speed", "FORMULA", "small_move_speed_bonus", null, 20));
  addEffect(attrEffect("small_attack_speed", "小型纳尔攻速", "小型本体攻速比例增量；比例属性1表示100%。", "bonus_attack_speed_percent", "FORMULA", "small_attack_speed_bonus", null, 30));
  addEffect(attrEffect("small_attack_range", "小型纳尔射程", "小型本体射程增量；源树起点省略，实际值由运行层提供。", "attack_range", "FORMULA", "small_attack_range_bonus", null, 40));
}, [
  { item: "巨型属性、怒气变形和转换流程", reason: "当前范围只录小型本体；不创建独立形态单位。" },
], [
  { item: "TotalMS完整角色曲线、TotalAS中间曲线、TotalAttackRange起点", reason: "客户端只给断点或终点，保持无默认实际输入。" },
], "小型本体三项属性保留；巨型属性和变形流程明确排除。", "可体验为小型纳尔面板属性和攻速/移速随等级变化，但实际成长要由运行层提供。");

define("Gnar", "Q", "投掷回力标", 5, (add, addFormula) => {
  add(dataParam("Gnar", "Q", "MiniBaseDamage", "mini_damage_base", "小型首段基础物理伤害", "INTEGER", "MiniBaseDamage索引1至5为5/45/85/125/165；不把返程半伤当第二次命中。", 10));
  add(fixed("total_ad_ratio", "小型回力标总攻击力倍率", "DECIMAL", coefficient("Gnar", "Q", "MiniTotalDamage", 1), "MiniTotalDamage树的1.25总攻击力倍率。", 20));
  add(dataParam("Gnar", "Q", "SlowAmount", "slow_ratio", "减速比例", "DECIMAL", "小型减速15%至35%，比例单位。", 30));
  add(fixedData("Gnar", "Q", "SlowDuration", "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "源值2秒转换为整数毫秒。", 40, 1, value => toMs(value, "Gnar/Q/SlowDuration")));
  add(fixedData("Gnar", "Q", "MiniCDRefund", "catch_cooldown_refund_ratio", "接住回力标返还比例", "DECIMAL", "接住返还40%只记录命中资格，不写返还基准和时点。", 50));
  add(fixed("display_range", "官方显示射程", "INTEGER", official("Gnar", "Q").range[0], "官方中文16.17.1显示射程1100。", 60));
  add(fixed("missile_range", "客户端飞弹射程", "INTEGER", 1200, "逐槽核对说明记录飞弹射程1200；与官方显示射程分开。", 70));
  add(fixedMsField("Gnar", "Q", "spellCastTime", "spell_cast_time_ms", "客户端spellCastTime（毫秒）", "客户端spellCastTime=0.25秒；不代表返程命中时点。", 80));
  addFormula(f("mini_physical_damage", "小型回力标首段物理伤害", ADD(P("mini_damage_base"), MUL(P("total_ad_ratio"), sourceTotalAD())), "首段=5/45/85/125/165+1.25×来源总攻击力；每个敌人只处理一次。", 90), ev("MiniTotalDamage", ADD(SD("MiniBaseDamage"), MUL(SC(coefficient("Gnar", "Q", "MiniTotalDamage", 1), "MiniTotalDamage.mCoefficient"), SA("SOURCE", "attack_damage", "TOTAL"))), "PHYSICAL"));
}, [
  { item: "返程后续敌人半伤、巨型顽石、巨型范围和野怪分支", reason: "本轮只保留小型第一目标单次命中。" },
], [
  { item: "接住返还的基础冷却和执行时点", reason: "只保留40%资格，公共冷却只读复用。" },
], "只录小型首段伤害、减速、接住返还资格、显示与施法时间；不新增已保护冷却。", "施放后可看到首个敌人的单次物理伤害和减速，返程命中不会被静态候选重复计伤。");

define("Gnar", "W", "亢奋", 5, (add, addFormula, addEffect) => {
  add(dataParam("Gnar", "W", "MiniBaseDamage", "third_hit_base_damage", "第三次命中基础魔法伤害", "INTEGER", "MiniBaseDamage索引1至5为0/10/20/30/40；只在同一目标第三次命中触发。", 10));
  add(dataParam("Gnar", "W", "MiniPercentHPDamage", "target_max_hp_ratio", "目标最大生命比例", "DECIMAL", "MiniPercentHPDamage为6%至14%，比例单位。", 20));
  add(fixed("ability_power_ratio", "第三次命中法强倍率", "DECIMAL", coefficient("Gnar", "W", "MiniTotalDamage", 1), "MiniTotalDamage树的法强倍率1。", 30));
  add(fixedData("Gnar", "W", "MiniMarkDuration", "mark_duration_ms", "第三次命中标记窗口（毫秒）", "INTEGER", "源值3.5秒。", 40, 1, value => toMs(value, "Gnar/W/MiniMarkDuration")));
  add(fixedData("Gnar", "W", "MiniHasteDuration", "move_speed_duration_ms", "移速衰减持续时间（毫秒）", "INTEGER", "源值3秒；衰减曲线不额外假定。", 50, 1, value => toMs(value, "Gnar/W/MiniHasteDuration")));
  add(fixedData("Gnar", "W", "MiniMaxStacks", "preloaded_max_stacks", "预存最大层数", "INTEGER", "当前源值最多2层。", 60));
  add(fixed("r_unlearned_move_speed_ratio", "未学习R时移速比例", "DECIMAL", ratio(dataAt("Gnar", "R", "RHyperMovementSpeedPercent", 1)), "W正文引用R等级；未学习R为20%，比例属性。", 70));
  add(fixed("r_level_1_move_speed_ratio", "R一级移速比例", "DECIMAL", ratio(dataAt("Gnar", "R", "RHyperMovementSpeedPercent", 2)), "W正文引用R一级40%移速；以独立固定档保存，不能套W五级。", 80));
  add(fixed("r_level_2_move_speed_ratio", "R二级移速比例", "DECIMAL", ratio(dataAt("Gnar", "R", "RHyperMovementSpeedPercent", 3)), "W正文引用R二级60%移速；以独立固定档保存。", 81));
  add(fixed("r_level_3_move_speed_ratio", "R三级移速比例", "DECIMAL", ratio(dataAt("Gnar", "R", "RHyperMovementSpeedPercent", 4)), "W正文引用R三级80%移速；以独立固定档保存。", 82));
  add(runtime("actual_r_qualified_move_speed_ratio", "当前R等级资格后的移速比例", "DECIMAL", "跨槽资格和实际移速由运行层提供；未学习R使用20%，不设默认。", 90));
  addFormula(f("third_hit_magic_damage", "亢奋第三次命中魔法伤害", ADD(P("third_hit_base_damage"), ADD(MUL(P("ability_power_ratio"), sourceAP()), MUL(P("target_max_hp_ratio"), targetHP()))), "第三次同目标命中=基础+1×法强+6%至14%目标最大生命。", 100), ev("MiniTotalDamage", ADD(SD("MiniBaseDamage"), ADD(MUL(SC(coefficient("Gnar", "W", "MiniTotalDamage", 1), "MiniTotalDamage.mCoefficient"), SA("SOURCE", "ability_power", "TOTAL")), MUL(SD("MiniPercentHPDamage"), SA("TARGET", "hp", "TOTAL")))), "MAGIC"));
  addEffect(attrEffect("third_hit_move_speed", "亢奋移速", "第三次命中后自身移速比例增量；移速随R等级资格并在3秒内衰减。", "move_speed_percent", "PARAMETER", "actual_r_qualified_move_speed_ratio", "move_speed_duration_ms", 110));
}, [
  { item: "巨型痛殴、野怪300封顶和离开巨型触发", reason: "当前仅保留小型本体被动。" },
], [
  { item: "同目标命中事件、移速衰减曲线和跨R等级资格", reason: "保留无默认实际输入和R槽资格边界。" },
], "小型W只保存第三次同目标命中、最大生命魔伤、标记/层数和引用R等级的移速；不生成菜单施法。", "连续命中同一目标三次后展示一次附加魔伤与短时移速，R等级决定移速档位。");

define("Gnar", "E", "轻跳", 5, (add, addFormula, addEffect) => {
  add(dataParam("Gnar", "E", "MiniDamage", "mini_damage_base", "小型弹跳基础物理伤害", "INTEGER", "MiniDamage索引1至5为50/85/120/155/190。", 10));
  add(fixed("source_max_hp_ratio", "自身最大生命倍率", "DECIMAL", dataAt("Gnar", "E", "MiniTotalDamageHPRatio", 1), "MiniTotalDamageHPRatio源值0.06，使用自身最大生命。", 20));
  add(dataParam("Gnar", "E", "MinibAS", "attack_speed_ratio", "小型攻速比例", "DECIMAL", "小型攻速40%至60%，比例属性。", 30));
  add(fixedData("Gnar", "E", "MiniASDuration", "attack_speed_duration_ms", "攻速持续时间（毫秒）", "INTEGER", "源值6秒。", 40, 1, value => toMs(value, "Gnar/E/MiniASDuration")));
  add(fixedData("Gnar", "E", "MoveSpeedMod", "slow_ratio", "落点减速比例", "DECIMAL", "源值为负0.8，按正文80%减速记录正比例。", 50, 1, value => Math.abs(value)));
  add(fixedData("Gnar", "E", "SlowDuration", "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "源值0.5秒。", 60, 1, value => toMs(value, "Gnar/E/SlowDuration")));
  add(fixedData("Gnar", "E", "MiniRange", "jump_range", "小型跳跃距离", "INTEGER", "小型跳跃475。", 70));
  add(fixedData("Gnar", "E", "MiniBounceRange", "bounce_range", "小型弹跳距离", "INTEGER", "小型弹跳525。", 80));
  add(fixedData("Gnar", "E", "TravelTime", "travel_time_ms", "原始飞行时间（毫秒）", "INTEGER", "TravelTime=0.6秒，独立于施法字段。", 90, 1, value => toMs(value, "Gnar/E/TravelTime")));
  add(fixedMsField("Gnar", "E", "spellCastTime", "spell_cast_time_ms", "客户端spellCastTime（毫秒）", "spellCastTime=0.25秒。", 100));
  addFormula(f("mini_physical_damage", "小型轻跳弹跳物理伤害", ADD(P("mini_damage_base"), MUL(P("source_max_hp_ratio"), sourceHP())), "小型=50/85/120/155/190+6%自身最大生命。", 110), ev("MiniTotalDamage", ADD(SD("MiniDamage"), MUL(SD("MiniTotalDamageHPRatio"), SA("SOURCE", "hp", "TOTAL"))), "PHYSICAL"));
  addEffect(attrEffect("mini_attack_speed", "小型轻跳攻速", "小型跳跃后自身攻速比例增量，持续6秒。", "bonus_attack_speed_percent", "PARAMETER", "attack_speed_ratio", "attack_speed_duration_ms", 120));
}, [
  { item: "巨型猛踏、巨型范围伤害和其他单位借跳链", reason: "只处理当前敌方一次小型弹跳。" },
], [
  { item: "弹跳目标资格和命中时点", reason: "保留范围、TravelTime与无默认事件输入。" },
], "小型伤害、最大生命口径、攻速、减速和跳跃时间/距离分开保存；不把返跳扩为多敌伤害。", "跳到当前敌人时产生一次物理伤害和减速，并提供6秒攻速比例。");

define("Gnar", "R", "呐啊", 3, (add) => {
  add(fixed("unlearned_move_speed_ratio", "未学习R时W移速比例", "DECIMAL", ratio(dataAt("Gnar", "R", "RHyperMovementSpeedPercent", 1)), "R正文小型被动未学习时20%，仅作为W资格参考。", 10));
  add(skill("learned_move_speed_ratio", "R等级对应W移速比例", "DECIMAL", levelValuesFromData("Gnar", "R", "RHyperMovementSpeedPercent", 3, ratio), "R1/2/3对应40%/60%/80%，仅服务W被动资格。", 20));
  add(runtime("actual_learned_move_speed_ratio", "当前R等级实际W移速比例", "DECIMAL", "R槽主动没有可复用公共冷却，本轮由运行层提供当前W资格，不设默认。", 30));
}, [
  { item: "巨型主动伤害、撞墙、击退、巨型冷却、施法和主动消耗", reason: "当前快照该槽无公共冷却，范围只保留小型W移速被动资格。" },
], [
  { item: "小型被动实际读取时点", reason: "仅记录R等级档位，事件接线待后续。" },
], "R不宣称小型可主动施放；只保留W引用的R等级移速资格，未新增巨型R冷却。", "玩家体验只影响W的移速档位；R主动链和其无快照冷却不在本候选。");

// 克烈
define("Kled", "P", "怯战蜥蜴", 1, (add, addFormula) => {
  const sk = calcPart("Kled", "P", "SkaarlHealth");
  add(fixed("skaarl_base_health_start", "斯嘎尔承伤池基础起点", "INTEGER", sk.mStartValue, "SkaarlHealth角色成长起点400。", 10));
  add(fixed("skaarl_base_health_end", "斯嘎尔承伤池基础终点", "INTEGER", sk.mEndValue, "SkaarlHealth角色成长终点1400；中间曲线未证。", 20));
  add(fixed("skaarl_bonus_health_ratio", "斯嘎尔额外生命池倍率", "DECIMAL", 1, "当前范围说明为加100%额外生命；不把承伤池重复加到角色生命。", 30));
  add(runtime("actual_skaarl_base_health", "当前斯嘎尔基础承伤池", "DECIMAL", "400至1400角色成长修正曲线未证，运行层提供实际基础池，不设默认。", 40));
  addFormula(f("skaarl_damage_pool", "斯嘎尔当前承伤池", ADD(P("actual_skaarl_base_health"), MUL(P("skaarl_bonus_health_ratio"), sourceBonusHP())), "承伤池=当前基础池+1×来源额外生命；不生成独立单位。", 50), ev("SkaarlHealth", ADD(SR("actual_skaarl_base_health"), MUL(SC(1, "范围说明100%额外生命"), SA("SOURCE", "hp", "BONUS"))), "RESOURCE", "基础池曲线使用运行输入"));
}, [
  { item: "脱骑替换技能、脱骑属性、勇气回骑和过渡无敌", reason: "属于本轮跳过的形态替换。" },
  { item: "缺值CourageChampionTakedown和DismountDistancePerEnemyChamp", reason: "源数组为null，不能填默认。" },
], [
  { item: "斯嘎尔基础池角色成长中间曲线和损伤消费时点", reason: "端点和实际运行输入分开保存。" },
], "只保留骑乘斯嘎尔承伤池；不把斯嘎尔建成独立战斗单位或重复增加角色生命。", "骑乘状态的承伤池可作为运行时输入参与伤害承受，脱骑替换流程仍由事件层处理。");

define("Kled", "Q", "飞索捕熊器", 5, (add, addFormula) => {
  add(dataParam("Kled", "Q", "FirstHitBaseDamage", "first_hit_damage_base", "首次命中基础物理伤害", "INTEGER", "FirstHitBaseDamage索引1至5为30/55/80/105/130。", 10));
  add(fixed("bonus_ad_ratio", "首次命中额外攻击力倍率", "DECIMAL", coefficient("Kled", "Q", "TotalDamage", 1), "TotalDamage树的0.6额外攻击力倍率。", 20));
  add(fixedData("Kled", "Q", "TetherPopDamageMultiplier", "tether_pop_multiplier", "牵引第二段相对倍率", "DECIMAL", "第二段是首段伤害×2，不把2倍当完整两段总量。", 30));
  add(fixed("full_two_segment_multiplier", "两段完整伤害倍率", "DECIMAL", 3, "首段1倍加第二段2倍，完整两段合计3倍。", 40));
  add(dataParam("Kled", "Q", "SlowAmount", "slow_ratio", "牵引减速比例", "DECIMAL", "源值为负30%至负50%，按正文减速幅度记录正比例。", 50, Math.abs));
  add(fixedData("Kled", "Q", "SlowDuration", "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "源值2.5秒。", 60, 1, value => toMs(value, "Kled/Q/SlowDuration")));
  add(fixedData("Kled", "Q", "TetherPopTime", "tether_time_ms", "牵引成立时间（毫秒）", "INTEGER", "源值1.75秒。", 70, 1, value => toMs(value, "Kled/Q/TetherPopTime")));
  add(fixedMsField("Kled", "Q", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "mCastTime=0.25秒。", 80));
  add(fixed("cast_range", "施法范围", "INTEGER", fieldArray("Kled", "Q", "castRange")[1], "客户端施法范围800。", 90));
  addFormula(f("first_physical_damage", "飞索捕熊器首次物理伤害", ADD(P("first_hit_damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "首次=30/55/80/105/130+0.6×额外攻击力。", 100), ev("TotalDamage", ADD(SD("FirstHitBaseDamage"), MUL(SC(coefficient("Kled", "Q", "TotalDamage", 1), "TotalDamage.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), "PHYSICAL"));
  addFormula(f("tether_physical_damage", "飞索捕熊器牵引第二段伤害", MUL(ADD(P("first_hit_damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), P("tether_pop_multiplier")), "牵引第二段=首段×2。", 110), ev("TotalYankDamage", MUL(ADD(SD("FirstHitBaseDamage"), MUL(SC(coefficient("Kled", "Q", "TotalDamage", 1), "TotalDamage.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), SC(dataAt("Kled", "Q", "TetherPopDamageMultiplier"), "TetherPopDamageMultiplier")), "PHYSICAL"));
  addFormula(f("full_two_segment_physical_damage", "飞索捕熊器两段完整物理伤害", MUL(ADD(P("first_hit_damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), P("full_two_segment_multiplier")), "完整两段=首段×3，第二段2倍不作为总量。", 120), ev("TotalYankDamage", MUL(ADD(SD("FirstHitBaseDamage"), MUL(SC(coefficient("Kled", "Q", "TotalDamage", 1), "TotalDamage.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), SC(3, "首段1倍+第二段2倍")), "PHYSICAL"));
}, [
  { item: "脱骑随身手枪、兵野分支和40%重伤/5秒残留字段", reason: "当前正文未消费这些分支。" },
], [
  { item: "牵引资格、命中时点和第二段实际事件", reason: "数值倍率分开保存，实际事件待接线。" },
], "骑乘首段、第二段2倍及完整3倍总量分开；不把正文未消费的重伤字段写成效果。", "首次钩中和牵引成立会产生两次可区分物理伤害，完整值按1+2倍核算。");

define("Kled", "W", "暴烈秉性", 5, (add, addFormula, addEffect) => {
  add(fixedData("Kled", "W", "AttackSpeed", "attack_speed_ratio", "四次攻击攻速比例", "DECIMAL", "源值150%，比例属性1表示100%。", 10));
  add(fixedData("Kled", "W", "ActiveDuration", "attack_window_ms", "四次攻击窗口（毫秒）", "INTEGER", "源值4秒，和四次攻击资格并列。", 20, 1, value => toMs(value, "Kled/W/ActiveDuration")));
  add(dataParam("Kled", "W", "4HitMaxHealthDamage", "fourth_max_hp_percent_points", "第四击最大生命百分数点", "DECIMAL", "源值4.5/5/5.5/6/6.5为百分数点，尚未乘0.01。", 30));
  add(dataParam("Kled", "W", "BaseFlatDamage", "fourth_flat_damage", "第四击额外基础物理伤害", "INTEGER", "第四击基础20/30/40/50/60。", 40));
  add(fixed("source_percent_unit", "百分数点转比例单位", "DECIMAL", 0.01, "源计算树的mMultiplier=0.01；百分数点乘此值才成为比例。", 50));
  add(fixed("bonus_ad_percent_points", "额外攻击力百分数点系数", "DECIMAL", coefficient("Kled", "W", "PercentDamage", 1), "源树额外攻击力项0.02仍是百分数点系数。", 60));
  add(fixed("bonus_hp_percent_points", "额外生命百分数点系数", "DECIMAL", calcPart("Kled", "W", "PercentDamage", 2).mCoefficient, "源树额外生命项0.004仍是百分数点系数，不能遗漏。", 70));
  add(fixed("fourth_attack_count", "攻击次数", "INTEGER", 4, "正文明确四次攻击。", 80));
  add(fixedData("Kled", "W", "ChampCooldownRefund", "champion_cooldown_refund_ms", "命中英雄返还冷却（毫秒）", "INTEGER", "英雄攻击返还1.5秒自身W冷却。", 90, 1, value => toMs(value, "Kled/W/ChampCooldownRefund")));
  const sourcePercentBracket = ADD(SD("4HitMaxHealthDamage"), ADD(MUL(SC(coefficient("Kled", "W", "PercentDamage", 1), "PercentDamage.AD"), SA("SOURCE", "attack_damage", "BONUS")), MUL(SC(calcPart("Kled", "W", "PercentDamage", 2).mCoefficient, "PercentDamage.HP"), SA("SOURCE", "hp", "BONUS"))));
  const sourcePercentRatio = MUL(SC(multiplierNumber("Kled", "W", "PercentDamage"), "PercentDamage.mMultiplier"), sourcePercentBracket);
  const sourcePercentDamage = MUL(sourcePercentRatio, SA("TARGET", "hp", "TOTAL"));
  const candidatePercentBracket = ADD(P("fourth_max_hp_percent_points"), ADD(MUL(P("bonus_ad_percent_points"), sourceBonusAD()), MUL(P("bonus_hp_percent_points"), sourceBonusHP())));
  const candidatePercentRatio = MUL(P("source_percent_unit"), candidatePercentBracket);
  const candidatePercentDamage = MUL(candidatePercentRatio, targetHP());
  addFormula(f("fourth_max_hp_ratio", "第四击最大生命伤害比例", candidatePercentRatio, "第四击比例=0.01×(4.5至6.5+0.02额外攻击力+0.004额外生命)。", 100), ev("PercentDamage", sourcePercentRatio, "PHYSICAL"));
  addFormula(f("fourth_max_hp_damage", "第四击最大生命物理伤害", candidatePercentDamage, "第四击目标最大生命部分。", 110), ev("PercentDamage", sourcePercentDamage, "PHYSICAL"));
  addFormula(f("fourth_total_extra_damage", "第四击额外物理伤害", ADD(P("fourth_flat_damage"), candidatePercentDamage), "第四击额外伤害=基础值+最大生命比例部分。", 120), ev("PercentDamage", ADD(SD("BaseFlatDamage"), sourcePercentDamage), "PHYSICAL"));
  addEffect(attrEffect("attack_speed", "暴烈秉性攻速", "四次攻击或4秒内自身攻速比例增量。", "bonus_attack_speed_percent", "PARAMETER", "attack_speed_ratio", "attack_window_ms", 130));
}, [
  { item: "非英雄返还0.5秒、野怪封顶和非英雄分支", reason: "纯额外目标分支排除。" },
], [
  { item: "四次攻击消费、英雄返还时点和实际目标最大生命", reason: "数值已保留，事件资格待接线。" },
], "第四击最大生命比例保留百分数点到比例的单位转换，并明确额外生命项；公共W冷却只读复用。", "触发W后提供150%攻速至多四次或4秒，第四击再按基础加目标最大生命计算。");

define("Kled", "E", "比武", 5, (add, addFormula, addEffect) => {
  add(dataParam("Kled", "E", "BaseDamage", "dash_damage_base", "冲刺物理伤害基础值", "INTEGER", "BaseDamage索引1至5为35/60/85/110/135。", 10));
  add(fixed("bonus_ad_ratio", "冲刺额外攻击力倍率", "DECIMAL", coefficient("Kled", "E", "TotalDamage", 1), "TotalDamage树的0.55额外攻击力倍率。", 20));
  add(fixedData("Kled", "E", "MoveSpeed", "hero_move_speed_ratio", "命中英雄移速比例", "DECIMAL", "命中英雄获得50%移速，比例属性。", 30));
  add(fixedData("Kled", "E", "MoveSpeedDuration", "hero_move_speed_duration_ms", "命中英雄移速持续（毫秒）", "INTEGER", "源值1秒。", 40, 1, value => toMs(value, "Kled/E/MoveSpeedDuration")));
  add(fixedData("Kled", "E", "RecastWindow", "recast_window_ms", "再次施放窗口（毫秒）", "INTEGER", "源值3秒。", 50, 1, value => toMs(value, "Kled/E/RecastWindow")));
  add(fixedData("Kled", "E", "DashSpeed", "dash_speed", "冲刺速度", "INTEGER", "源值600。", 60));
  add(fixedData("Kled", "E", "PassthroughDistance", "passthrough_distance", "穿过初始目标距离", "INTEGER", "源值350。", 70));
  add(fixedData("Kled", "E", "TetherRange", "tether_range", "牵引范围", "INTEGER", "源值700。", 80));
  add(fixed("cast_range", "施法范围", "INTEGER", fieldArray("Kled", "E", "castRange")[1], "客户端施法范围550。", 90));
  addFormula(f("dash_physical_damage", "比武冲刺物理伤害", ADD(P("dash_damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "每次=35/60/85/110/135+0.55×额外攻击力。", 100), ev("TotalDamage", ADD(SD("BaseDamage"), MUL(SC(coefficient("Kled", "E", "TotalDamage", 1), "TotalDamage.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), "PHYSICAL"));
  addFormula(f("recast_dash_physical_damage", "比武再次冲刺物理伤害", ADD(P("dash_damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "再次穿过同一目标时造成等额伤害。", 110), ev("TotalDamage", ADD(SD("BaseDamage"), MUL(SC(coefficient("Kled", "E", "TotalDamage", 1), "TotalDamage.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), "PHYSICAL"));
  addEffect(attrEffect("hero_move_speed", "比武命中英雄移速", "命中英雄后自身移速比例增量，持续1秒；3秒再施放资格单独记录。", "move_speed_percent", "PARAMETER", "hero_move_speed_ratio", "hero_move_speed_duration_ms", 120));
}, [
  { item: "小兵拉拽和纯视野分支", reason: "本轮只保留当前敌方英雄路径。" },
], [
  { item: "第二次冲刺命中和英雄资格", reason: "等额伤害已表达，事件时点待接线。" },
], "保留两次同敌冲刺的等额伤害、命中英雄移速、再施放窗口和四个距离/速度边界。", "冲刺命中英雄会给自身短时移速并打开3秒再施放窗口，第二次对同目标仍按等额伤害。");

define("Kled", "R", "冲啊", 3, (add, addFormula, addEffect) => {
  add(dataParamMax("Kled", "R", "ShieldCapBase", "shield_base", "最高护盾基础值", "INTEGER", 3, "源值排名为200/300/400。", 10));
  add(dataParamMax("Kled", "R", "PercentHPBase", "damage_percent_points", "最大生命伤害百分数点", "DECIMAL", 3, "源值排名为4/6/8百分数点，仍需乘0.01。", 20));
  add(fixed("bonus_ad_percent_points", "冲撞额外攻击力百分数点", "DECIMAL", coefficient("Kled", "R", "{598e3ed3}", 1), "同一括号内额外攻击力百分数点系数0.03。", 30));
  add(fixed("percent_point_unit", "百分数点转比例单位", "DECIMAL", 0.01, "PercentHPBase和0.03额外攻击力均为百分数点口径。", 40));
  add(fixed("minimum_charge_multiplier", "最小冲撞距离倍率", "DECIMAL", multiplierNumber("Kled", "R", "MinimumDamageTooltip"), "源最小伤害树倍率0.01。", 50));
  add(fixed("maximum_charge_multiplier", "最大冲撞距离倍率", "DECIMAL", multiplierNumber("Kled", "R", "MaximumChargeDamage"), "源最大伤害树倍率0.03。", 60));
  add(dataParamMax("Kled", "R", "SecondsToMaxPower", "shield_source_max_power_duration_ms", "源护盾最大值增长时间（毫秒）", "INTEGER", 3, "扩展源字段3秒；与官方正文2秒并存，不擅合。", 70, value => toMs(value, "Kled/R/SecondsToMaxPower")));
  add(fixed("shield_growth_text_duration_ms", "官方正文护盾增长时间（毫秒）", "INTEGER", 2000, "官方中文正文写开始冲锋后2秒内至多获得护盾。", 80));
  add(runtime("shield_duration_ms", "护盾实际寿命（毫秒）", "INTEGER", "护盾寿命和移除时点未证，使用无默认运行输入，避免把护盾当永久效果。", 90));
  add(officialLevels("Kled", "R", "range", 3) ? skill("range", "官方冲锋范围", "INTEGER", officialLevels("Kled", "R", "range", 3), "官方中文16.17.1范围3500/4000/4500。", 100) : null);
  add(fixed("cast_range_source", "客户端冲锋范围起点", "INTEGER", fieldArray("Kled", "R", "castRange")[1], "客户端范围rank1为3500；与官方等级数组分开。", 110));
  const candidateDamageBracket = ADD(P("damage_percent_points"), MUL(P("bonus_ad_percent_points"), sourceBonusAD()));
  const candidateMinimumDamage = MUL(MUL(P("minimum_charge_multiplier"), P("percent_point_unit")), MUL(candidateDamageBracket, targetHP()));
  const candidateMaximumDamage = MUL(MUL(P("maximum_charge_multiplier"), P("percent_point_unit")), MUL(candidateDamageBracket, targetHP()));
  addFormula(f("damage_percent_bracket_points", "冲撞最大生命伤害括号百分数点", candidateDamageBracket, "括号=4/6/8+0.03×额外攻击力，单位为百分数点。", 120), ev("{598e3ed3}", ADD(SD("PercentHPBase"), MUL(SC(coefficient("Kled", "R", "{598e3ed3}", 1), "{598e3ed3}.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), "MAGIC"));
  addFormula(f("minimum_magic_damage", "冲撞最小魔法伤害", candidateMinimumDamage, "最小=0.01×括号百分数点×0.01×目标最大生命。", 130), ev("MinimumDamageTooltip", MUL(MUL(SC(multiplierNumber("Kled", "R", "MinimumDamageTooltip"), "MinimumDamageTooltip.mMultiplier"), SC(0.01, "百分数点转比例")), MUL(ADD(SD("PercentHPBase"), MUL(SC(coefficient("Kled", "R", "{598e3ed3}", 1), "{598e3ed3}.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), SA("TARGET", "hp", "TOTAL"))), "MAGIC"));
  addFormula(f("maximum_magic_damage", "冲撞最大魔法伤害", candidateMaximumDamage, "最大=0.03×同一括号百分数点×0.01×目标最大生命。", 140), ev("MaximumChargeDamage", MUL(MUL(SC(multiplierNumber("Kled", "R", "MaximumChargeDamage"), "MaximumChargeDamage.mMultiplier"), SC(0.01, "百分数点转比例")), MUL(ADD(SD("PercentHPBase"), MUL(SC(coefficient("Kled", "R", "{598e3ed3}", 1), "{598e3ed3}.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), SA("TARGET", "hp", "TOTAL"))), "MAGIC"));
  addFormula(f("maximum_shield", "冲啊最高护盾", ADD(P("shield_base"), MUL(P("shield_bonus_ad_ratio"), sourceBonusAD())), "最高护盾=200/300/400+3×额外攻击力。", 150), ev("MaximumShield", ADD(SD("ShieldCapBase"), MUL(SC(coefficient("Kled", "R", "MaximumShield", 1), "MaximumShield.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), "SHIELD"));
  add(fixed("shield_bonus_ad_ratio", "护盾额外攻击力倍率", "DECIMAL", coefficient("Kled", "R", "MaximumShield", 1), "MaximumShield树的3倍额外攻击力。", 155));
  addEffect(shieldEffect("charge_shield", "冲啊自身护盾", "自身护盾数值保留；实际寿命使用无默认输入，2秒正文与3秒源增长时间不混合。", "maximum_shield", "shield_duration_ms", 160));
}, [
  { item: "友军加速轨迹、友军路径和额外敌方分配", reason: "本轮只保留自身护盾和首个敌方英雄冲撞。" },
], [
  { item: "距离增长曲线、护盾寿命和冲撞资格", reason: "最小/最大公式及两套时间边界保留，事件层待接线。" },
], "冲撞伤害明确为魔法；最小/最大距离、百分数点单位、目标最大生命和护盾寿命输入分开。", "冲锋自身护盾可在有寿命输入时应用，冲撞伤害按移动距离选择最小到最大边界。");

// 奎因
define("Quinn", "P", "侵扰", 1, (add, addFormula) => {
  const bonus = calc("Quinn", "P", "BonusDamage");
  add(fixed("mark_damage_level1_base", "标记伤害角色等级起点", "INTEGER", bonus.mFormulaParts[0].mStartValue, "BonusDamage角色等级起点15。", 10));
  add(fixed("mark_damage_level18_base", "标记伤害角色等级终点", "INTEGER", bonus.mFormulaParts[0].mEndValue, "BonusDamage角色等级终点120；中间曲线未证。", 20));
  add(fixed("bonus_ad_ratio", "标记额外攻击力倍率", "DECIMAL", dataAt("Quinn", "P", "ADRatio", 1), "当前ADRatio=0.4，按额外攻击力口径。", 30));
  add(fixed("mode_damage_multiplier", "模式伤害倍率", "DECIMAL", dataAt("Quinn", "P", "ModesPassiveDamageMultiplier", 1), "当前模式倍率1；不引入其他模式分支。", 40));
  add(fixedData("Quinn", "P", "RevealDuration", "reveal_duration_ms", "显形持续时间（毫秒）", "INTEGER", "RevealDuration=4秒，仅代表显形，不混作侵扰标记寿命。", 50, 1, value => toMs(value, "Quinn/P/RevealDuration")));
  add(runtime("actual_mark_damage_base", "当前角色等级标记基础伤害", "DECIMAL", "15至120角色等级曲线未证，运行层提供当前基础值，不设默认。", 60));
  add(runtime("actual_mark_cooldown_ratio", "当前标记冷却缩短比例", "DECIMAL", "@f1@来源未具名，运行层提供实际值，不设默认。", 70));
  add(runtime("actual_critical_reduction_ratio", "当前标记暴击缩短比例", "DECIMAL", "暴击缩短来源未具名，运行层提供实际值，不设默认。", 80));
  addFormula(f("marked_attack_physical_damage", "侵扰标记额外物理伤害", MUL(ADD(P("actual_mark_damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), P("mode_damage_multiplier")), "标记额外伤害=(角色等级基础+0.4×额外攻击力)×当前模式倍率。", 90), ev("BonusDamage", MUL(ADD(SR("actual_mark_damage_base"), MUL(SD("ADRatio"), SA("SOURCE", "attack_damage", "BONUS"))), SD("ModesPassiveDamageMultiplier")), "PHYSICAL", "基础曲线使用运行输入"));
}, [
  { item: "华洛独立单位、纯显形事件和野怪额外75伤害", reason: "只保留人物自身标记普攻。" },
], [
  { item: "角色等级中间曲线、@f1@冷却和暴击缩短", reason: "未知内容无默认实际输入。" },
], "标记后的额外普攻伤害保留角色等级端点和额外AD；RevealDuration只作为显形字段，不当标记寿命。", "侵扰目标后的下一次普攻可使用当前等级基础值与额外AD计算额外物理伤害。");

define("Quinn", "Q", "炫目攻势", 5, (add, addFormula) => {
  add(dataParam("Quinn", "Q", "BaseDamage", "damage_base", "基础物理伤害", "INTEGER", "BaseDamage索引1至5为65/100/135/170/205。", 10));
  add(dataParam("Quinn", "Q", "ADRatio", "bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", "ADRatio索引1至5为0.8/0.85/0.9/0.95/1.0。", 20));
  add(fixedData("Quinn", "Q", "APRatio", "ap_ratio", "法强倍率", "DECIMAL", "APRatio=0.5。", 30));
  add(fixedData("Quinn", "Q", "VisionReductionDuration", "vision_reduction_duration_ms", "视野受限持续时间（毫秒）", "INTEGER", "源值1.75秒。", 40, 1, value => toMs(value, "Quinn/Q/VisionReductionDuration")));
  add(fixed("cast_range_source", "客户端原始范围", "INTEGER", fieldArray("Quinn", "Q", "castRange")[1], "客户端原始范围1050。", 50));
  add(fixed("display_range", "官方显示范围", "INTEGER", official("Quinn", "Q").range[0], "官方显示范围1025，与客户端原始范围分开。", 60));
  add(fixed("missile_range", "飞弹范围", "INTEGER", 1550, "逐槽核对说明记录飞弹范围1550。", 70));
  add(fixedMsField("Quinn", "Q", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "客户端mCastTime=0.25秒。", 80));
  addFormula(f("physical_damage", "炫目攻势物理伤害", ADD(ADD(P("damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), MUL(P("ap_ratio"), sourceAP())), "伤害=65至205+0.8至1.0×额外攻击力+0.5×法强。", 90), ev("TotalDamage", ADD(ADD(SD("BaseDamage"), MUL(SD("ADRatio"), SA("SOURCE", "attack_damage", "BONUS"))), MUL(SD("APRatio"), SA("SOURCE", "ability_power", "TOTAL"))), "PHYSICAL"));
}, [
  { item: "纯开图、非英雄缴械和野怪双倍", reason: "纯额外目标或地图分支排除；同一敌人标记资格保留。" },
], [
  { item: "首个命中目标、视野受限时点和标记消费", reason: "数值和1.75秒资格记录，事件层待接线。" },
], "Q伤害明确区分额外AD与法强，并保存原始范围、显示范围、飞弹范围和250毫秒施法。", "命中目标会造成一次物理伤害并施加侵扰/视野受限资格，伤害不会把法强项错算成攻击力。");

define("Quinn", "W", "敏锐感知", 5, (add, addFormula, addEffect) => {
  add(dataParam("Quinn", "W", "AttackSpeedBonus", "attack_speed_ratio", "侵扰目标后的攻速比例", "DECIMAL", "被动攻速28%至80%，比例属性。", 10));
  add(dataParam("Quinn", "W", "MovespeedAmount", "move_speed_ratio", "侵扰目标后的移速比例", "DECIMAL", "被动移速20%至40%，比例属性。", 20));
  add(fixedData("Quinn", "W", "BuffDuration", "buff_duration_ms", "被动强化持续时间（毫秒）", "INTEGER", "源值2秒。", 30, 1, value => toMs(value, "Quinn/W/BuffDuration")));
  addEffect(attrEffect("marked_attack_speed", "敏锐感知攻速", "攻击侵扰目标后自身攻速比例增量。", "bonus_attack_speed_percent", "PARAMETER", "attack_speed_ratio", "buff_duration_ms", 40));
  addEffect(attrEffect("marked_move_speed", "敏锐感知移速", "攻击侵扰目标后自身移速比例增量。", "move_speed_percent", "PARAMETER", "move_speed_ratio", "buff_duration_ms", 50));
}, [
  { item: "主动开图、主动视野、主动施法和专用消耗/冷却", reason: "快照该槽参数为空，当前范围只录被动属性。" },
], [
  { item: "侵扰标记消费和强化应用时点", reason: "被动数值和2秒寿命已知，事件待接线。" },
], "W只保存侵扰目标后的攻速、移速和2秒持续；不因范围文笼统字样补开图冷却。", "攻击侵扰目标后获得两项比例属性增量，持续2秒。");

define("Quinn", "E", "旋翔掠杀", 5, (add, addFormula) => {
  add(dataParam("Quinn", "E", "BaseDamage", "damage_base", "旋翔掠杀基础物理伤害", "INTEGER", "BaseDamage索引1至5为40/65/90/115/140。", 10));
  add(fixed("bonus_ad_ratio", "旋翔掠杀额外攻击力倍率", "DECIMAL", coefficient("Quinn", "E", "TotalDamage", 1), "TotalDamage树的0.2额外攻击力倍率。", 20));
  add(fixedData("Quinn", "E", "SlowAmount", "slow_ratio", "初始减速比例", "DECIMAL", "源值50%，比例单位；衰减曲线未知。", 30));
  add(fixedData("Quinn", "E", "SlowDecayTime", "slow_decay_time_ms", "减速衰减时间（毫秒）", "INTEGER", "源值1.5秒。", 40, 1, value => toMs(value, "Quinn/E/SlowDecayTime")));
  add(fixedMsField("Quinn", "E", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "客户端mCastTime=0.25秒。", 50));
  add(fixed("cast_range_source", "客户端原始范围", "INTEGER", fieldArray("Quinn", "E", "castRange")[1], "客户端原始范围600。", 60));
  add(fixed("display_range", "官方显示范围", "INTEGER", official("Quinn", "E").range[0], "官方显示范围675。", 70));
  addFormula(f("physical_damage", "旋翔掠杀物理伤害", ADD(P("damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "伤害=40至140+0.2×额外攻击力。", 80), ev("TotalDamage", ADD(SD("BaseDamage"), MUL(SC(coefficient("Quinn", "E", "TotalDamage", 1), "TotalDamage.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS"))), "PHYSICAL"));
}, [
  { item: "纯视野、额外目标和非英雄专用分支", reason: "本轮只保留当前敌方英雄路径。" },
], [
  { item: "减速衰减曲线、后跳资格和侵扰消费时点", reason: "保存初始值和衰减时长，不假定全程恒定。" },
], "E伤害、50%初始减速、1.5秒衰减时间和原始/显示范围分开；不把未知衰减写成恒定效果。", "命中后造成物理伤害并施加侵扰，减速在1.5秒内按未证曲线衰减。");

define("Quinn", "R", "深入敌后", 3, (add, addFormula, addEffect) => {
  add(dataParamMax("Quinn", "R", "MovementSpeedMod", "move_speed_ratio", "合体移速比例", "DECIMAL", 3, "R1/2/3为70%/100%/130%，比例属性。"));
  add(dataParamMax("Quinn", "R", "BaseDamage", "end_damage_base", "结束攻击基础物理伤害", "INTEGER", 3, "R1/2/3为60/90/120。", 20));
  add(fixed("bonus_ad_ratio", "结束攻击额外攻击力倍率", "DECIMAL", dataAt("Quinn", "R", "ADRatio", 1), "ADRatio=0.35，mStatFormula=2表示额外攻击力。", 30));
  add(fixed("channel_duration_ms", "合体引导时间（毫秒）", "INTEGER", 2000, "官方中文正文明确引导2秒；不与250毫秒施法字段混合。", 40));
  add(fixedMsField("Quinn", "R", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "客户端mCastTime=0.25秒，独立于2秒引导。", 50));
  add(fixed("cast_range_source", "客户端原始范围", "INTEGER", fieldArray("Quinn", "R", "castRange")[1], "客户端原始范围650。", 60));
  add(fixed("display_range", "官方显示范围", "INTEGER", 700, "逐槽核对说明记录显示范围700。", 70));
  add(skill("cooldown_ms", "基础冷却时间（毫秒）", "INTEGER", officialLevels("Quinn", "R", "cooldown", 3, value => toMs(value, "Quinn/R/cooldown")), "官方16.17.1冷却3/3/3秒；本批无同名公共参数，按新参数计划。", 80));
  add(skill("mana_cost", "基础法力消耗", "INTEGER", officialLevels("Quinn", "R", "cost", 3), "官方16.17.1法力50/25/0；0是官方真实值而非时间占位。", 90));
  add(runtime("active_duration_ms", "实际合体持续时间（毫秒）", "INTEGER", "技能持续到退出或被打断，实际持续时点由运行层提供，不设默认。", 100));
  addFormula(f("move_speed_bonus", "深入敌后移速比例", P("move_speed_ratio"), "R等级移速70%/100%/130%。", 110), ev("MovementSpeedMod", SD("MovementSpeedMod"), "ATTRIBUTE"));
  addFormula(f("end_physical_damage", "鹰翼天翔结束物理伤害", ADD(P("end_damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "结束=60/90/120+0.35×额外攻击力。", 120), ev("Damage", ADD(SD("BaseDamage"), MUL(SD("ADRatio"), SA("SOURCE", "attack_damage", "BONUS"))), "PHYSICAL"));
  addEffect(attrEffect("r_move_speed", "深入敌后移速", "合体期间自身移速比例增量，实际持续到退出，寿命使用无默认输入。", "move_speed_percent", "FORMULA", "move_speed_bonus", "active_duration_ms", 130));
}, [
  { item: "华洛独立变形、其他敌方分配和地图轨迹", reason: "华洛不建独立单位；本体R保留。" },
], [
  { item: "2秒引导后的实际退出时点、非小兵受伤移除资格和侵扰标记时点", reason: "资格与时序由事件层接线。" },
], "R保留本体移速与结束攻击；冷却/法力取官方3/3/3和50/25/0，250毫秒施法与2秒引导分开。", "引导结束后获得合体移速，退出时对附近英雄造成一次额外AD物理伤害并标记侵扰。");

// 雷克塞
define("RekSai", "P", "艾克塞之怒", 1, (add) => {
  add(fixedData("RekSai", "P", "FuryFromAttacks", "fury_from_attack", "普攻生成怒气", "INTEGER", "地表普攻每次生成25怒气。", 10));
  add(fixedData("RekSai", "P", "FuryFromAbilities", "fury_from_ability", "技能命中生成怒气", "INTEGER", "地表技能命中每次生成25怒气。", 20));
  add(fixedData("RekSai", "P", "PauseDuration", "fury_generation_pause_ms", "停止生成怒气后的等待时间（毫秒）", "INTEGER", "源值5秒。", 30, 1, value => toMs(value, "RekSai/P/PauseDuration")));
  add(fixed("fury_decay_per_second", "每秒怒气衰减", "INTEGER", 20, "当前扩展正文明确5秒不生成后每秒失去20怒气；该值不在DataValues，按范围说明保存。", 40));
  add(runtime("actual_fury", "当前怒气", "DECIMAL", "怒气状态由运行层提供，不填0默认。", 50));
  add(runtime("actual_fury_cap", "当前满怒阈值", "DECIMAL", "满怒阈值未在本槽冻结源中独立证实，运行层提供，不设默认。", 60));
}, [
  { item: "地底消耗怒气治疗、小兵16%和野怪特殊分支", reason: "纯地底/兵野分支排除，但不因其存在删除地表怒气本体。" },
], [
  { item: "怒气满值、衰减起算事件和E消费时点", reason: "保留无默认状态输入。" },
], "P保留地表怒气生成和扩展正文衰减，服务E满怒资格；不新建地底治疗效果。", "地表普攻或技能命中会为怒气状态增加25，停手5秒后按每秒20衰减，具体状态由运行时接线。");

define("RekSai", "Q", "女王之怒", 5, (add, addFormula, addEffect) => {
  add(fixedData("RekSai", "Q", "BuffDuration", "attack_buff_duration_ms", "三次攻击窗口（毫秒）", "INTEGER", "源值3秒；每次攻击刷新窗口。", 10, 1, value => toMs(value, "RekSai/Q/BuffDuration")));
  add(fixedData("RekSai", "Q", "AttackSpeed", "attack_speed_ratio", "三次攻击攻速比例", "DECIMAL", "源值35%，比例属性。", 20));
  add(dataParam("RekSai", "Q", "UnburrowedADRatio", "total_ad_ratio", "地表额外物理伤害总攻击力倍率", "DECIMAL", "TotalDamageTooltip只保留0.3/0.35/0.4/0.45/0.5总攻击力；不添加残留基础伤害。", 30));
  add(fixed("attack_count", "地表强化攻击次数", "INTEGER", 3, "官方正文明确下3次普攻。", 40));
  addFormula(f("unburrowed_physical_damage", "女王之怒地表额外物理伤害", MUL(P("total_ad_ratio"), sourceTotalAD()), "地表每次额外伤害只有总攻击力倍率，不加UnburrowedBaseDamage。", 50), ev("TotalDamageTooltip", MUL(SD("UnburrowedADRatio"), SA("SOURCE", "attack_damage", "TOTAL")), "PHYSICAL"));
  addEffect(attrEffect("attack_speed", "女王之怒攻速", "地表三次攻击期间自身攻速比例增量；每次攻击刷新窗口。", "bonus_attack_speed_percent", "PARAMETER", "attack_speed_ratio", "attack_buff_duration_ms", 60));
}, [
  { item: "地底猎物搜寻飞弹和地底整套技能", reason: "本轮只录地表Q。" },
], [
  { item: "主目标暴击资格、三次攻击消费和实际刷新时点", reason: "当前来源保留资格，事件层待接线。" },
], "Q严格使用当前TotalDamageTooltip的总AD倍率，明确排除残留5至25基础伤害；冷却只读复用。", "地表开启后下三次攻击获得35%攻速和对应总AD额外物伤，每次攻击刷新3秒窗口。");

define("RekSai", "W", "遁地 / 破土而出", 5, () => {}, [
  { item: "遁地、破土、地底移速、视野和震动感知整链", reason: "当前范围跳过W整套地底本体。" },
], [
  { item: "已保护基础冷却", reason: "快照已有4000毫秒公共参数；只读保护，不新建W专用组成。" },
], "W写入数组为空，只保留已保护公共冷却和范围说明；不按旧描述新增地底自疗。", "本批不在W槽生成新参数或效果，避免将整套替换技能误录入地表候选。");

define("RekSai", "E", "狂野之噬", 5, (add, addFormula) => {
  add(dataParam("RekSai", "E", "BaseDamage", "damage_base", "地表撕咬基础物理伤害", "INTEGER", "BaseDamage索引1至5为70/95/120/145/170。", 10));
  add(fixedData("RekSai", "E", "BonusAD", "bonus_ad_ratio", "撕咬额外攻击力倍率", "DECIMAL", "BaseDamageCalculation树的0.6额外攻击力倍率。", 20));
  add(fixedData("RekSai", "E", "EmpoweredRatio", "empowered_multiplier", "满怒整段伤害倍率", "DECIMAL", "满怒时整段×1.2并转为真实伤害，不能与普通伤害相加。", 30));
  add(fixedMsField("RekSai", "E", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "mCastTime=0.25秒。", 40));
  add(fixedMsField("RekSai", "E", "spellCastTime", "spell_cast_time_ms", "客户端spellCastTime（毫秒）", "spellCastTime=0.25秒，与mCastTime分列。", 50));
  add(fixed("cast_range_source", "客户端原始范围", "INTEGER", fieldArray("RekSai", "E", "castRange")[1], "客户端原始范围225。", 60));
  add(fixed("display_range", "官方显示范围", "INTEGER", official("RekSai", "E").range[0], "官方显示范围250。", 70));
  addFormula(f("unempowered_physical_damage", "雷克塞地表撕咬物理伤害", ADD(P("damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), "普通地表=70至170+0.6×额外攻击力。", 80), ev("BaseDamageCalculation", ADD(SD("BaseDamage"), MUL(SD("BonusAD"), SA("SOURCE", "attack_damage", "BONUS"))), "PHYSICAL"));
  addFormula(f("empowered_true_damage", "雷克塞满怒撕咬真实伤害", MUL(ADD(P("damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), P("empowered_multiplier")), "满怒整段=普通撕咬×1.2并改为真实伤害。", 90), ev("EmpoweredDamageCalculation", MUL(ADD(SD("BaseDamage"), MUL(SD("BonusAD"), SA("SOURCE", "attack_damage", "BONUS"))), SD("EmpoweredRatio")), "TRUE"));
}, [
  { item: "地底隧道、隧道寿命、速度和复用冷却", reason: "地形对象链本轮排除。" },
], [
  { item: "满怒资格和实际伤害类型触发时点", reason: "普通/强化两条公式分开，事件层待接线。" },
], "E普通伤害与满怒整段1.2倍真实伤害分开；不补隧道链，施法字段与225/250范围分开。", "未满怒时造成物理伤害，满怒时同一段伤害整体乘1.2并转为真实伤害。");

define("RekSai", "R", "虚空猛冲", 3, (add, addFormula) => {
  add(dataParamMax("RekSai", "R", "RBaseDamage", "damage_base", "虚空猛冲基础物理伤害", "INTEGER", 3, "R1/2/3为150/250/350。", 10));
  add(dataParamMax("RekSai", "R", "PercentHealthDamage", "target_max_hp_percent_points", "目标最大生命百分数点", "DECIMAL", 3, "R1/2/3为15/20/25百分数点，需乘0.01。", 20));
  add(fixedData("RekSai", "R", "ADRatio", "bonus_ad_ratio", "虚空猛冲额外攻击力倍率", "DECIMAL", "RBaseDamageCalc树mStat2/mStatFormula2，ADRatio=1。", 30));
  add(fixed("percent_point_unit", "百分数点转比例单位", "DECIMAL", 0.01, "PercentHealthDamage源值为百分数点。", 40));
  add(fixedData("RekSai", "R", "PreyMarkDuration", "prey_mark_duration_ms", "猎物资格持续时间（毫秒）", "INTEGER", "伤害后5秒内可以选取。", 50, 1, value => toMs(value, "RekSai/R/PreyMarkDuration")));
  add(fixedData("RekSai", "R", "LeapMovementSpeed", "leap_speed", "跃进速度", "INTEGER", "源值1400。", 60));
  add(fixedData("RekSai", "R", "ExtraDistance", "extra_distance", "额外跃进距离", "INTEGER", "源值125。", 70));
  add(fixed("cast_range", "施法范围", "INTEGER", fieldArray("RekSai", "R", "castRange")[1], "客户端范围1500。", 80));
  add(fixedData("RekSai", "R", "CastBuffDuration", "cast_buff_duration_ms", "施法阶段无敌/不可选取窗口（毫秒）", "INTEGER", "CastBuffDuration=1.1秒；只记录阶段字段，不当完整遁地形态。", 90, 1, value => toMs(value, "RekSai/R/CastBuffDuration")));
  add(fixedMsField("RekSai", "R", "mCastTime", "m_cast_time_ms", "客户端mCastTime（毫秒）", "mCastTime=0.35秒。", 100));
  add(fixedMsField("RekSai", "R", "spellCastTime", "spell_cast_time_ms", "客户端spellCastTime（毫秒）", "spellCastTime=0.25秒，与mCastTime分列。", 110));
  add(fixedData("RekSai", "R", "DamageCheckRadius", "damage_check_radius", "伤害判定半径", "INTEGER", "源值1000；目标范围与判定半径分列。", 120));
  const candidatePercentHealthRatio = MUL(P("target_max_hp_percent_points"), P("percent_point_unit"));
  const candidateBasePlusAD = ADD(P("damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD()));
  const candidatePercentHealthDamage = MUL(candidatePercentHealthRatio, targetHP());
  addFormula(f("percent_health_ratio", "虚空猛冲最大生命伤害比例", candidatePercentHealthRatio, "15/20/25百分数点×0.01。", 130), ev("RBaseDamageCalc", MUL(SD("PercentHealthDamage"), SC(0.01, "PercentHealthDamage百分数点")), "PHYSICAL"));
  addFormula(f("base_plus_ad_damage", "虚空猛冲基础加额外AD伤害", candidateBasePlusAD, "基础150/250/350+1×额外攻击力。", 140), ev("RBaseDamageCalc", ADD(SD("RBaseDamage"), MUL(SD("ADRatio"), SA("SOURCE", "attack_damage", "BONUS"))), "PHYSICAL"));
  addFormula(f("total_physical_damage", "虚空猛冲总物理伤害", ADD(candidateBasePlusAD, candidatePercentHealthDamage), "总伤害=基础+额外AD+目标最大生命比例。", 150), ev("RBaseDamageCalc", ADD(ADD(SD("RBaseDamage"), MUL(SD("ADRatio"), SA("SOURCE", "attack_damage", "BONUS"))), MUL(MUL(SD("PercentHealthDamage"), SC(0.01, "PercentHealthDamage百分数点")), SA("TARGET", "hp", "TOTAL"))), "PHYSICAL"));
}, [
  { item: "地底整套变形、独立单位和W技能重置执行链", reason: "短暂遁地仅是R施法阶段，W整套范围排除。" },
], [
  { item: "5秒标记资格、不可选取/不可阻挡时点和实际目标锁定", reason: "资格和阶段参数已保留，事件层待接线。" },
], "R保留本体施法阶段和最大生命物理伤害；百分数点、mCastTime350、spellCastTime250及跃进边界分开。", "对5秒内曾被伤害的目标进行一次不可阻挡跃进，伤害使用目标最大生命而非当前或已损生命。");

const inputHashes = {};
const addSourceFile = (label, file) => {
  if (!file || !fs.existsSync(file)) return;
  inputHashes[label] = { sha256: shaFile(file), byteSize: fs.statSync(file).size };
};
for (const item of inputVersion.sourceFiles || []) {
  const file = path.join(INPUT, item.path.replaceAll("/", path.sep));
  assert(fs.existsSync(file), "输入源文件不存在：" + item.path);
  assert(shaFile(file) === item.sha256, "输入源文件散列不一致：" + item.path);
  addSourceFile(item.path, file);
}
for (const [label, file] of [
  ["来源绑定与当前文本.json", bindingFile],
  ["主负责人源值摘要.json", summaryFile],
  ["输入版本.json", versionFile],
  ["主负责人最终范围与核对说明.md", finalScopeFile],
  ["主负责人范围与核对要求.md", oldScopeFile],
  ["README.md", inputReadmeFile],
  ["参考资料/当前20槽保护快照.json", protectionFile],
  ["参考资料/公共参数复用清单.json", reuseFile],
  ["参考资料/属性默认与边界.json", attributeFile],
  ["参考资料/接口载荷样例.json", payloadFile],
  ["参考资料/当前中文文本.json", chineseTextFile],
  ["参考资料/技能来源索引.json", sourceIndexFile],
  ["参考资料/GET审计摘要.json", getAuditFile],
  ["Cursor来源复核结论.md", cursorReviewFile],
  ["Cursor主负责人执行审计.json", cursorAuditFile],
  ["Cursor-summary.json", cursorSummaryFile],
  ["Cursor-preflight.md", cursorPreflightFile],
  ["Cursor-events.jsonl", cursorEventsFile],
]) addSourceFile(label, file);

const counts = {
  newParameters: order.reduce((sum, key) => sum + defs[key].write.parameters.length, 0),
  newFormulas: order.reduce((sum, key) => sum + defs[key].write.formulas.length, 0),
  newEffects: order.reduce((sum, key) => sum + defs[key].write.effects.length, 0),
  newProcesses: 0,
  newInternalStates: 0,
  newTriggerRules: 0,
};
counts.newTotal = counts.newParameters + counts.newFormulas + counts.newEffects;
counts.reusedPublicParameters = reuseList.length;
counts.plannedTotalIncludingReused = counts.newTotal + counts.reusedPublicParameters;
counts.protectedCurrentCompositionLists = 120;

const requests = [];
for (const key of order) {
  const write = defs[key].write;
  for (const kind of ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"]) {
    for (const item of write[kind]) {
      const stableKey = item.parameterKey || item.formulaKey || item.effectKey || item.processKey || item.internalStateKey || item.triggerRuleKey;
      requests.push({
        sequence: requests.length + 1,
        operation: "POST",
        method: "POST",
        route: "/skills/" + key + "/" + kind,
        detailRoute: "/skills/" + key + "/" + kind + "/" + slug(stableKey),
        skillKey: key,
        kind,
        stableKey,
        execute: false,
        status: "仅意图，未调用",
        body: clone(item),
      });
    }
  }
}

const generatedAt = new Date().toISOString();
const meta = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "候选已生成，等待主负责人保存；未调用业务接口",
  gameId: "lol",
  apiBase: API_BASE,
  sourceVersion: { clientVersion: binding.clientVersion, officialVersion: binding.officialVersion, build: heroes.Gnar.source.client.contentVersion },
  sourcePolicy: "固定客户端16.17、官方16.17.1、当前根绑定sourceObject、最终范围、完整计算树和保护快照；明确值才进入候选，未知曲线/资格/阶段/寿命使用无默认实际输入。",
  scope: "纳尔小型本体与R对W移速资格、克烈骑乘QWER与斯嘎尔承伤池、奎因本体QWER与R临时状态、雷克塞地表P/Q/E与R施法阶段；额外整套形态、地底W链、华洛和斯嘎尔独立单位、兵野分支按最终范围排除。",
  sourceBindingSha256: inputHashes["来源绑定与当前文本.json"].sha256,
  sourceSummarySha256: inputHashes["主负责人源值摘要.json"].sha256,
  sourceRangeSha256: inputHashes["主负责人最终范围与核对说明.md"].sha256,
  sourceAuditSha256: inputHashes["主负责人范围与核对要求.md"].sha256,
  protectionSnapshotSha256: inputHashes["参考资料/当前20槽保护快照.json"].sha256,
  publicReuseSha256: inputHashes["参考资料/公共参数复用清单.json"].sha256,
  inputVersionSha256: inputHashes["输入版本.json"].sha256,
  inputGETs: protection.GETs,
  publicReuseCount: reuseList.length,
  apiCalls: 0,
  businessWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
  tokenStored: false,
  sourceReview,
};
const candidate = {
  meta,
  skills: Object.fromEntries(order.map(key => [key, defs[key]])),
  order,
  reusedPublicParameters: reuseList.map(item => ({ ...item, post: false, note: "保护对象只读复用，不在本批覆盖。" })),
  reusedExistingParameters: reuseList.map(item => ({ ...item, post: false, note: "现有公共参数按冻结GET复用。" })),
  counts,
  apiWrites: { post: false, requestsOnly: true, requestCount: requests.length },
  sourceFiles: inputHashes,
  sourceNotes: [
    "所有20槽来源绑定均使用sourceObject字段和其objectPath，未回退到不存在的object字段。",
    "Gnar R和Quinn W快照参数为空，不补巨型R或主动开图冷却；RekSai W只保护既有4000毫秒公共参数，不按旧描述补地底治疗。",
    "总攻击力、额外攻击力、目标最大生命和自身最大生命在公式节点中分开；Kled W额外生命项和RekSai Q无基础伤害均有独立源值说明。",
    "move_speed_percent与bonus_attack_speed_percent均按比例属性保存，效果乘区统一为attribute_flat_add；百分数点先乘0.01再进入比例公式。",
    "所有时间参数为整数毫秒；未知运行输入fixedValue和levelValues均为null，未用0作占位。",
  ],
  protectedObjects: {
    snapshot: ".agents/artifacts/hero49-root-entry-20260910/参考资料/当前20槽保护快照.json",
    snapshotSha256: inputHashes["参考资料/当前20槽保护快照.json"].sha256,
    inputGETs: protection.GETs,
    requestCount: protection.requests.length,
    routes: protectedRoutes,
    publicReuse: reuseList.map(item => ({ ...item, post: false })),
    note: "20个主体、六类当前组成、代表图、角色关系、字典和14项公共参数均只读保护；候选计划只新增本批未复用组成。",
  },
  revision: REVISION,
};
const candidateBytes = jsonBytes(candidate);
const candidateSha256 = sha256(candidateBytes);

const scopeReport = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "候选范围已按当前最终说明生成；未调用业务接口",
  currentScopeFile: "主负责人最终范围与核对说明.md",
  currentScopeSha256: inputHashes["主负责人最终范围与核对说明.md"].sha256,
  cursorReview: clone(sourceReview),
  inputGETs: protection.GETs,
  publicReuseCount: reuseList.length,
  attributeDictionary: Array.from(attributes).sort(),
  attributeChecks: "所有候选ATTRIBUTE节点和效果detail.attributeKey均由当前保护快照属性字典校验；比例属性效果使用attribute_flat_add。",
  decisions: {
    gnar: "只录小型本体P/Q/W/E及R对W移速资格；巨型R主动不新增，R无公共冷却。",
    kled: "只录骑乘P/Q/W/E/R；斯嘎尔是承伤池输入，不是独立单位；脱骑替换链排除。",
    quinn: "Q/W/E本体和R临时移速/结束伤害均保留；W主动开图不新增，R官方冷却和法力新建。",
    reksai: "P地表怒气、Q、E、R施法阶段保留；W整套地底链排除，既有4000毫秒公共冷却只读保护。",
  },
  skills: Object.fromEntries(order.map(key => [key, {
    sourceObjectField: defs[key].source.sourceObjectField,
    sourceObjectPath: defs[key].source.sourceObjectPath,
    parameters: defs[key].write.parameters.map(item => item.parameterKey),
    formulas: defs[key].write.formulas.map(item => item.formulaKey),
    effects: defs[key].write.effects.map(item => item.effectKey),
    excluded: clone(defs[key].excluded),
    pending: clone(defs[key].pending),
    experience: defs[key].experience,
  }])),
  noApiCalls: true,
  apiWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
};
const sourceValues = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "独立来源值与计算树摘要；未调用业务接口",
  sourceBindingSha256: inputHashes["来源绑定与当前文本.json"].sha256,
  sourceSummarySha256: inputHashes["主负责人源值摘要.json"].sha256,
  values: Object.fromEntries(order.map(key => {
    const def = defs[key];
    return [key, {
      sourceObjectField: def.source.sourceObjectField,
      sourceObjectPath: def.source.sourceObjectPath,
      objectName: def.source.sourceObjectName,
      sourceSummary: clone(def.source.sourceSummary),
      rawDataValues: clone(def.source.raw.dataValues),
      rawCalculations: clone(def.source.raw.calculations),
      rawFields: clone(def.source.raw.fields),
      selectedParameters: def.write.parameters.map(item => item.parameterKey),
      selectedFormulas: def.write.formulas.map(item => item.formulaKey),
      selectedEffects: def.write.effects.map(item => item.effectKey),
    }];
  })),
  noApiCalls: true,
  apiWrites: 0,
};

const mathScript = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const ROOT = path.dirname(fileURLToPath(import.meta.url));",
  "const INPUT = process.env.HERO49_INPUT ? path.resolve(process.env.HERO49_INPUT) : path.resolve(ROOT, '..', 'hero49-root-entry-20260910');",
  "const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));",
  "const candidate = readJson(path.join(ROOT, '完整候选.json'));",
  "const binding = readJson(path.join(INPUT, '来源绑定与当前文本.json'));",
  "const protection = readJson(path.join(INPUT, '参考资料', '当前20槽保护快照.json'));",
  "const sourceByKey = Object.fromEntries(binding.heroes.flatMap(hero => hero.skills.map(skill => [skill.skillKey, { hero, skill }])));",
  "const attrs = new Set((protection.dictionaries?.['/attributes']?.items || []).map(item => item.attributeKey));",
  "const reuse = new Set((candidate.reusedPublicParameters || []).map(item => item.skillKey + '/' + item.parameterKey));",
  "const finite = value => typeof value === 'number' && Number.isFinite(value);",
  "const fail = (list, message) => list.push(message);",
  "const dataAt = (key, name, rank) => { const sp = sourceByKey[key].skill.sourceObject.mSpell; const row = (sp.DataValues || []).find(item => item.name === name); if (!row || !Array.isArray(row.values) || row.values[rank] === undefined) throw new Error('source data missing ' + key + '/' + name + '/' + rank); return row.values[rank]; };",
  "const evalNode = (node, ctx, sourceMode = false) => {",
  "  if (!node) throw new Error('空表达式节点');",
  "  if (node.nodeType === 'PARAMETER') { const p = ctx.def.write.parameters.find(item => item.parameterKey === node.parameterKey); if (!p) { if (reuse.has(ctx.key + '/' + node.parameterKey)) throw new Error('复用参数未注入数学快照：' + node.parameterKey); throw new Error('参数引用不存在：' + ctx.key + '/' + node.parameterKey); } if (p.valueMode === 'RUNTIME_INPUT') { if (!(node.parameterKey in ctx.runtime)) throw new Error('缺少运行输入：' + ctx.key + '/' + node.parameterKey); return ctx.runtime[node.parameterKey]; } if (p.valueMode === 'FIXED') return p.fixedValue; return p.levelValues[String(ctx.rank)]; }",
  "  if (node.nodeType === 'ATTRIBUTE' || node.nodeType === 'SOURCE_ATTRIBUTE') { const a = ctx.values[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind]; if (!finite(a)) throw new Error('缺少属性场景：' + node.attributeOwner + '/' + node.attributeKey + '/' + node.attributeValueKind); return a; }",
  "  if (node.nodeType === 'SOURCE_DATA') return dataAt(ctx.key, node.dataName, ctx.rank) * node.transform;",
  "  if (node.nodeType === 'SOURCE_RUNTIME') { if (!(node.runtimeKey in ctx.runtime)) throw new Error('缺少来源运行输入：' + ctx.key + '/' + node.runtimeKey); return ctx.runtime[node.runtimeKey]; }",
  "  if (node.nodeType === 'SOURCE_CONSTANT') return node.value;",
  "  if (node.nodeType === 'OPERATION') { if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error('操作数不是2'); const left = evalNode(node.operands[0], ctx, sourceMode); const right = evalNode(node.operands[1], ctx, sourceMode); if (node.operation === 'ADD') return left + right; if (node.operation === 'MULTIPLY') return left * right; throw new Error('未知运算：' + node.operation); }",
  "  throw new Error('未知节点类型：' + node.nodeType);",
  "};",
  "const runtimeValue = (p, rank) => { if (p.valueType === 'INTEGER' || p.parameterKey.endsWith('_ms')) return p.parameterKey.includes('count') || p.parameterKey.includes('stacks') ? 3 : 1500 + rank * 100; if (p.parameterKey.includes('ratio')) return 0.25 + rank * 0.01; if (p.parameterKey.includes('health')) return 900 + rank * 100; return 1 + rank * 0.1; };",
  "const scenariosFor = (key, def, rank) => { const runtime = {}; for (const p of def.write.parameters) if (p.valueMode === 'RUNTIME_INPUT') runtime[p.parameterKey] = runtimeValue(p, rank); return { key, def, rank, runtime, values: { SOURCE: { attack_damage: { TOTAL: rank === 1 ? 220 : 420, BONUS: rank === 1 ? 110 : 210 }, ability_power: { TOTAL: rank === 1 ? 300 : 500 }, hp: { TOTAL: rank === 1 ? 1800 : 2600, BONUS: rank === 1 ? 400 : 700 } }, TARGET: { hp: { TOTAL: rank === 1 ? 2400 : 3600 } } } }; };",
  "const refs = (node, callback) => { if (!node || typeof node !== 'object') return; callback(node); if (node.nodeType === 'OPERATION') for (const operand of node.operands || []) refs(operand, callback); };",
  "const checkTypes = (report, key, def) => { const own = new Set(def.write.parameters.map(item => item.parameterKey)); const formulas = new Set(def.write.formulas.map(item => item.formulaKey)); const checkExpr = (expr, where) => refs(expr, node => { if (node.nodeType === 'PARAMETER' && !own.has(node.parameterKey) && !reuse.has(key + '/' + node.parameterKey)) fail(report.failures, '悬空参数引用 ' + where + '/' + node.parameterKey); if (node.nodeType === 'ATTRIBUTE' && !attrs.has(node.attributeKey)) fail(report.failures, '属性不存在 ' + where + '/' + node.attributeKey); if (node.nodeType === 'OPERATION' && (!Array.isArray(node.operands) || node.operands.length !== 2)) fail(report.failures, '非二元运算 ' + where); }); for (const formula of def.write.formulas) checkExpr(formula.expression, key + '/formula/' + formula.formulaKey); for (const effect of def.write.effects) for (const result of effect.results || []) { if (result.valueRule?.value?.kind === 'PARAMETER' && !own.has(result.valueRule.value.parameterKey) && !reuse.has(key + '/' + result.valueRule.value.parameterKey)) fail(report.failures, '效果参数引用不存在 ' + key + '/' + result.valueRule.value.parameterKey); if (result.valueRule?.value?.kind === 'FORMULA' && !formulas.has(result.valueRule.value.formulaKey)) fail(report.failures, '效果公式引用不存在 ' + key + '/' + result.valueRule.value.formulaKey); if (result.detail?.attributeKey && !attrs.has(result.detail.attributeKey)) fail(report.failures, '效果属性不存在 ' + key + '/' + result.detail.attributeKey); if (result.detail?.attributeKey === 'move_speed_percent' || result.detail?.attributeKey === 'bonus_attack_speed_percent') { report.effectUnits.push({ key, effectKey: effect.effectKey, attributeKey: result.detail.attributeKey, modifierZoneKey: result.detail.modifierZoneKey, unit: '1=100%' }); if (result.detail.modifierZoneKey !== 'attribute_flat_add') fail(report.failures, '比例属性未使用attribute_flat_add ' + key + '/' + effect.effectKey); } if (result.valueRule && !finite(result.valueRule.fixedMultiplier)) fail(report.failures, '效果最终倍率非有限数字 ' + key + '/' + effect.effectKey); } };",
  "const checkArrays = (report, key, def) => { for (const p of def.write.parameters) { if (p.valueMode === 'RUNTIME_INPUT') { if (p.fixedValue !== null || p.levelValues !== null) fail(report.failures, '运行输入含默认值 ' + key + '/' + p.parameterKey); continue; } const values = p.levelValues; if (p.valueMode === 'SKILL_LEVEL') { const expected = Array.from({ length: def.maxLevel }, (_, i) => String(i + 1)); if (!values || JSON.stringify(Object.keys(values)) !== JSON.stringify(expected)) fail(report.failures, '技能等级数组不完整 ' + key + '/' + p.parameterKey); } if (p.valueMode === 'CHARACTER_LEVEL') { const expected = Array.from({ length: 18 }, (_, i) => String(i + 1)); if (!values || JSON.stringify(Object.keys(values)) !== JSON.stringify(expected)) fail(report.failures, '角色等级数组不完整 ' + key + '/' + p.parameterKey); } const all = p.valueMode === 'FIXED' ? [p.fixedValue] : Object.values(values || {}); for (const value of all) { if (!finite(value)) fail(report.failures, '参数非有限数字 ' + key + '/' + p.parameterKey); if (p.valueType === 'INTEGER' && !Number.isInteger(value)) fail(report.failures, '整数参数含小数 ' + key + '/' + p.parameterKey); if (p.parameterKey.endsWith('_ms') && !Number.isInteger(value)) fail(report.failures, '毫秒参数非整数 ' + key + '/' + p.parameterKey); } } };",
  "const report = { generatedAt: new Date().toISOString(), batch: candidate.meta.batch, revision: candidate.meta.revision, status: '独立数学核算', tolerance: 0.00001, failures: [], formulas: [], effectUnits: [], sourceMatches: 0, formulaScenarios: 0, missingRuntimeRejected: 0, typeReferencesChecked: 0, parameterArraysChecked: 0, finalEffectMultipliers: [] };",
  "for (const key of candidate.order) { const def = candidate.skills[key]; checkTypes(report, key, def); checkArrays(report, key, def); report.parameterArraysChecked += def.write.parameters.length; for (const formula of def.write.formulas) { const evidence = def.formulaEvidence?.[formula.formulaKey]; if (!evidence?.sourceRule) { fail(report.failures, '缺少原始来源公式规则 ' + key + '/' + formula.formulaKey); continue; } for (const rank of [1, def.maxLevel]) { const ctx = scenariosFor(key, def, rank); report.formulaScenarios += 1; let candidateValue; let sourceValue; try { candidateValue = evalNode(formula.expression, ctx); sourceValue = evalNode(evidence.sourceRule, ctx, true); } catch (error) { fail(report.failures, '公式求值失败 ' + key + '/' + formula.formulaKey + '/rank' + rank + ': ' + error.message); continue; } const delta = Math.abs(candidateValue - sourceValue); const check = { key, formulaKey: formula.formulaKey, rank, sourceCalculation: evidence.sourceCalculation, candidateValue, sourceValue, delta, matched: delta < report.tolerance }; report.formulas.push(check); if (check.matched) report.sourceMatches += 1; else fail(report.failures, '候选与源值不一致 ' + key + '/' + formula.formulaKey + '/rank' + rank); const runtimeParams = def.write.parameters.filter(item => item.valueMode === 'RUNTIME_INPUT' && JSON.stringify(formula.expression).includes(item.parameterKey)); if (runtimeParams.length) { const missing = { ...ctx, runtime: {} }; let rejected = false; try { evalNode(formula.expression, missing); } catch { rejected = true; } if (rejected) report.missingRuntimeRejected += 1; else fail(report.failures, '缺运行输入未拒绝 ' + key + '/' + formula.formulaKey + '/rank' + rank); } } } for (const effect of def.write.effects) for (const result of effect.results || []) if (result.valueRule) report.finalEffectMultipliers.push({ key, effectKey: effect.effectKey, resultKey: result.resultKey, fixedMultiplier: result.valueRule.fixedMultiplier, attributeKey: result.detail?.attributeKey || null, modifierZoneKey: result.detail?.modifierZoneKey || null }); }",
  "report.typeReferencesChecked = report.formulaScenarios + report.parameterArraysChecked;",
  "report.status = report.failures.length ? '失败' : '通过';",
  "fs.writeFileSync(path.join(ROOT, '独立数学报告.json'), JSON.stringify(report, null, 2) + '\\n');",
  "console.log(JSON.stringify({ status: report.status, formulaScenarios: report.formulaScenarios, sourceMatches: report.sourceMatches, missingRuntimeRejected: report.missingRuntimeRejected, failures: report.failures.length, report: path.join(ROOT, '独立数学报告.json') }, null, 2));",
  "if (report.failures.length) process.exitCode = 1;",
].join("\n") + "\n";

const plan = {
  generatedAt,
  status: "仅写入意图，未调用业务接口",
  batch: BATCH,
  revision: REVISION,
  apiBase: API_BASE,
  sourceVersion: clone(meta.sourceVersion),
  candidateSha256,
  sourceBindingSha256: meta.sourceBindingSha256,
  sourceRangeSha256: meta.sourceRangeSha256,
  sourceAuditSha256: meta.sourceAuditSha256,
  protectionSnapshotSha256: meta.protectionSnapshotSha256,
  publicReuseSha256: meta.publicReuseSha256,
  requestCount: requests.length,
  counts: clone(counts),
  reusedPublicParameters: reuseList.map(item => ({ ...item, post: false })),
  protectedRoutes,
  protectedSummary: { inputGETs: protection.GETs, inputRequestCount: protection.requests.length, note: "写前保护快照只读；本计划不覆盖已有主体或组成。" },
  requests,
  noApiCalls: true,
  apiWrites: 0,
  businessWrites: 0,
};
const planBytes = jsonBytes(plan);
const planSha256 = sha256(planBytes);
const scopeBytes = jsonBytes(scopeReport);
const scopeSha256 = sha256(scopeBytes);
const sourceBytes = jsonBytes(sourceValues);
const sourceSha256 = sha256(sourceBytes);
const version = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "候选已生成，未调用业务接口",
  candidateSha256,
  planSha256,
  sourceValuesSha256: sourceSha256,
  sourceScopeSha256: scopeSha256,
  sourceReview: clone(sourceReview),
  counts: clone(counts),
  requestCount: requests.length,
  inputGETs: protection.GETs,
  publicReuseCount: reuseList.length,
  sourceMath: "独立数学核算.mjs",
  sourceMathStatus: "待执行",
  apiCalls: 0,
  businessWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
};
const hashSummary = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  candidateSha256,
  planSha256,
  sourceValuesSha256: sourceSha256,
  sourceScopeSha256: scopeSha256,
  sourceFiles: inputHashes,
  sourceReview: clone(sourceReview),
  apiCalls: 0,
  businessWrites: 0,
};
const experienceLines = [
  "# 第四十九批候选体验报告",
  "",
  "候选覆盖纳尔、克烈、奎因、雷克塞20个技能槽。来源固定客户端16.17、官方16.17.1、当前sourceObject绑定、最终范围和186条GET保护快照。Cursor来源复核为READY（2946事件、79个唯一工具、24项冻结输入、业务写入0、Git零变化），但候选尚未保存。",
  "",
  "14项公共参数只读复用；Gnar R和Quinn W没有快照公共参数，因此没有补巨型R或主动开图冷却。RekSai W仅保留已保护4000毫秒公共冷却，不按旧描述新增地底治疗。",
  "",
  "所有技能槽体验边界如下：",
];
for (const key of order) {
  experienceLines.push("");
  experienceLines.push("## " + key + " " + defs[key].name);
  experienceLines.push("");
  experienceLines.push(defs[key].experience);
  if (defs[key].excluded.length) experienceLines.push("排除：" + defs[key].excluded.map(item => item.item).join("；") + "。");
  if (defs[key].pending.length) experienceLines.push("待接：" + defs[key].pending.map(item => item.item).join("；") + "。");
}
experienceLines.push("");
experienceLines.push("固定数值均通过有限数值和整数毫秒约束；比例属性效果使用attribute_flat_add。独立数学脚本会按每条公式两个等级场景核对候选表达式和原始来源规则，并检查缺运行输入拒绝、类型引用、等级数组、属性存在性、最终效果倍率。");
experienceLines.push("");
experienceLines.push("候选、请求计划、来源摘要和数学报告是静态设计证据，未执行业务接口、数据库、浏览器或战斗运行。");
const experience = experienceLines.join("\n") + "\n";
const readme = [
  "# 第四十九批候选",
  "",
  "本目录保存纳尔、克烈、奎因、雷克塞20个技能槽的候选和请求计划。来源固定客户端16.17、官方16.17.1及当前根绑定sourceObject。",
  "",
  "当前范围：纳尔小型本体与R对W移速资格；克烈骑乘QWER与斯嘎尔承伤池；奎因QWER与R临时状态；雷克塞地表P/Q/E与R施法阶段。地底W整链、额外整套形态、华洛/斯嘎尔独立单位和兵野分支按最终范围排除。",
  "",
  "Cursor来源复核为READY，但候选状态仍为等待主负责人保存；本目录没有调用业务接口。14项公共参数只读复用，186条GET保护快照只读保留。",
  "",
  "入口：完整候选.json、写前请求计划.json、请求计划.json、来源值与计算树.json、来源与范围核对.json、体验报告.md、独立数学核算.mjs、文件散列.json。",
  "",
  "未知曲线、资格、阶段、护盾寿命和运行属性使用无默认实际输入；比例属性统一使用attribute_flat_add，所有时间为整数毫秒。",
].join("\n") + "\n";
const index = {
  batch: BATCH,
  revision: REVISION,
  status: "候选已生成，等待主负责人保存；未调用业务接口",
  candidate: "完整候选.json",
  plan: "请求计划.json",
  preflightPlan: "写前请求计划.json",
  sourceValues: "来源值与计算树.json",
  scope: "来源与范围核对.json",
  experience: "体验报告.md",
  math: "独立数学核算.mjs",
  mathReport: "独立数学报告.json",
  shaManifest: "文件散列.json",
  candidateSha256,
  planSha256,
  sourceValuesSha256: sourceSha256,
  sourceScopeSha256: scopeSha256,
  sourceReview: { verdict: sourceReview.verdict, runId: sourceReview.runId, events: sourceReview.events, uniqueTools: sourceReview.uniqueTools, frozenInputs: sourceReview.frozenInputs },
  counts: clone(counts),
  requestCount: requests.length,
  noApiCalls: true,
  apiWrites: 0,
};
const manifest = {};
const artifacts = {
  "完整候选.json": candidateBytes,
  "写前请求计划.json": planBytes,
  "请求计划.json": planBytes,
  "来源值与计算树.json": sourceBytes,
  "来源值摘要.json": sourceBytes,
  "来源与范围核对.json": scopeBytes,
  "来源与范围.json": scopeBytes,
  "来源哈希汇总.json": jsonBytes(hashSummary),
  "候选版本.json": jsonBytes(version),
  "候选登记.json": jsonBytes(index),
  "README.md": Buffer.from(readme, "utf8"),
  "体验报告.md": Buffer.from(experience, "utf8"),
  "独立数学核算.mjs": Buffer.from(mathScript, "utf8"),
};
for (const [name, bytes] of Object.entries(artifacts)) {
  writeBytes(path.join(ROOT, name), bytes);
  manifest[name] = { sha256: sha256(bytes), byteSize: bytes.length };
}
manifest.generatedAt = generatedAt;
manifest.batch = BATCH;
manifest.revision = REVISION;
manifest.candidateSha256 = candidateSha256;
manifest.planSha256 = planSha256;
manifest.sourceValuesSha256 = sourceSha256;
manifest.sourceScopeSha256 = scopeSha256;
manifest.note = "本清单先列全部候选文件，独立数学报告运行后再由收尾命令补入；不包含自身以避免自引用。";
const manifestBytes = jsonBytes(manifest);
writeBytes(path.join(ROOT, "文件散列.json"), manifestBytes);
fs.mkdirSync(DURABLE, { recursive: true });
for (const [name, bytes] of Object.entries(artifacts)) {
  writeBytes(path.join(DURABLE, name), bytes);
  assert(shaFile(path.join(ROOT, name)) === shaFile(path.join(DURABLE, name)), "持久目录字节不一致：" + name);
}
writeBytes(path.join(DURABLE, "文件散列.json"), manifestBytes);
assert(shaFile(path.join(ROOT, "文件散列.json")) === shaFile(path.join(DURABLE, "文件散列.json")), "散列清单复制不一致");
console.log(JSON.stringify({
  batch: BATCH,
  revision: REVISION,
  sourceReview: { verdict: sourceReview.verdict, events: sourceReview.events, uniqueTools: sourceReview.uniqueTools, frozenInputs: sourceReview.frozenInputs },
  counts,
  requestCount: requests.length,
  candidateSha256,
  planSha256,
  sourceValuesSha256: sourceSha256,
  sourceScopeSha256: scopeSha256,
  publicReuse: reuseList.length,
  apiCalls: 0,
  businessWrites: 0,
  durable: DURABLE,
}, null, 2));
