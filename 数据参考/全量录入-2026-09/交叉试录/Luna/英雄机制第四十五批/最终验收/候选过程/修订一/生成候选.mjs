import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "..", "hero45-root-entry-20260910");
const REVIEW = path.resolve(ROOT, "..", "..", "hero45-cursor-review-run-20260910");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "英雄机制第四十五批提莫萨科黑默丁格婕拉";
const REVISION = "hero45-source-v1-luna-candidate-revision-1";
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
  if (value === null || value === undefined) return value;
  const number = Number(value);
  return Math.abs(number) < 1e-8 ? 0 : Number(number.toFixed(9));
};
const toMs = seconds => {
  const raw = Number(seconds);
  const milliseconds = raw * 1000;
  const rounded = Math.round(milliseconds);
  assert(Number.isFinite(raw) && raw >= 0 && Math.abs(milliseconds - rounded) <= 1e-6, `时间不是非负整数毫秒：${seconds}`);
  return rounded;
};
const decimalSeconds = seconds => {
  const raw = Number(seconds);
  assert(Number.isFinite(raw) && raw >= 0, `时间不是非负秒数：${seconds}`);
  return raw;
};

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

for (const file of [
  bindingFile, versionFile, rangeFile, sourceNoteFile, inputReadmeFile,
  protectionFile, reuseFile, attributeFile, payloadFile, cursorConclusionFile, cursorAuditFile,
]) assert(fs.existsSync(file), `缺少冻结输入：${file}`);

const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const cursorAudit = readJson(cursorAuditFile);
assert(binding.clientVersion === SOURCE_VERSION.clientVersion, "客户端版本不符");
assert(binding.officialVersion === SOURCE_VERSION.officialVersion, "官方版本不符");
assert(inputVersion.GETs === 194 && inputVersion.reusedParameters === 22, "第四十五批输入计数不符");
assert(inputVersion.apiWrites === 0, "冻结输入已有业务写入");
assert(cursorAudit.events === 3453 && cursorAudit.uniqueTools === 65 && cursorAudit.inputsChecked === 24, "Cursor审计计数不符");
assert(cursorAudit.apiWrites === 0 && Array.isArray(cursorAudit.gitDelta) && cursorAudit.gitDelta.length === 0, "Cursor审计存在写入或Git变化");

const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [
  hero.id,
  Object.fromEntries(hero.skills.map(skill => [skill.slot, skill])),
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
const resourceLevelValues = (heroId, slot, field, count, transform = value => value) => {
  const values = spell(heroId, slot)[field];
  assert(Array.isArray(values) && values.length >= count, `资源数组不足：${heroId}/${slot}/${field}`);
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index + 1), norm(transform(values[index]))]));
};
const calculation = (heroId, slot, name) => {
  const value = (spell(heroId, slot).mSpellCalculations || {})[name];
  assert(value, `缺少计算树：${heroId}/${slot}/${name}`);
  return value;
};
const calculationPart = (heroId, slot, name, index = 0) => {
  const parts = calculation(heroId, slot, name).mFormulaParts || [];
  assert(parts[index], `缺少计算树分支：${heroId}/${slot}/${name}/${index}`);
  return parts[index];
};
const coefficient = (heroId, slot, name, index = 1) => {
  const part = calculationPart(heroId, slot, name, index);
  assert(typeof part.mCoefficient === "number", `缺少树系数：${heroId}/${slot}/${name}/${index}`);
  return norm(part.mCoefficient);
};
const field = (heroId, slot, name) => spell(heroId, slot)[name];
const fixedTimeMs = (heroId, slot, name = "spellCastTime") => {
  const value = field(heroId, slot, name);
  assert(typeof value === "number", `缺少时间字段：${heroId}/${slot}/${name}`);
  return toMs(value);
};
const fixedSeconds = (heroId, slot, name = "spellCastTime") => {
  const value = field(heroId, slot, name);
  assert(typeof value === "number", `缺少时间字段：${heroId}/${slot}/${name}`);
  return decimalSeconds(value);
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
const SUB = (left, right) => O("SUBTRACT", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const totalAD = () => A("SOURCE", "attack_damage", "TOTAL");
const bonusAD = () => A("SOURCE", "attack_damage", "BONUS");

const fixed = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "FIXED", fixedValue: norm(fixedValue), levelValues: null, description, sortOrder,
});
const skill = (parameterKey, name, valueType, values, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "SKILL_LEVEL", fixedValue: null, levelValues: values, description, sortOrder,
});
const character = (parameterKey, name, valueType, values, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "CHARACTER_LEVEL", fixedValue: null, levelValues: values, description, sortOrder,
});
const runtime = (parameterKey, name, valueType, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "RUNTIME_INPUT", fixedValue: null, levelValues: null, description, sortOrder,
});
const formula = (formulaKey, name, expression, description, sortOrder) => ({
  formulaKey, name, expression, description, sortOrder,
});
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
const parameterValueRule = parameterKey => ({
  value: { kind: "PARAMETER", parameterKey }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null,
});
const formulaValueRule = formulaKey => ({
  value: { kind: "FORMULA", formulaKey }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null,
});
const resourceEffect = (resource, parameterKey, description = "仅记录基础资源消耗；实际扣除时点和施放资格由事件层接线。", sortOrder = 900) => ({
  effectKey: `${resource}_cost`,
  name: `施放${resource === "mana" ? "法力" : resource === "energy" ? "能量" : resource}消耗`,
  description,
  sortOrder,
  lifecycle: null,
  results: [{
    resultKey: "consume_resource",
    name: "施放资源消耗",
    resultType: "RESOURCE_CHANGE",
    target: "SOURCE",
    description: "不表示战斗事件已经接线。",
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: parameterValueRule(parameterKey),
    detail: { attributeKey: resource, operation: "CONSUME" },
  }],
});
const attributeEffect = (effectKey, name, parameterKey, attributeKey, durationKey, description, sortOrder = 20) => ({
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
    valueRule: parameterValueRule(parameterKey),
    detail: { attributeKey, operation: "INCREASE", modifierZoneKey: "attribute_flat_add" },
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
    clientSha256: shaFile(clientFile),
    clientCompressedSha256: hero.source.client.compressedSha256,
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
        "mDoesNotConsumeCooldown", "mTargetingTypeData", "mClientData",
      ].map(key => [key, rawSpell[key] ?? null])),
    },
    officialEvidence: { zh: clone(officialFor(heroId, slot)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}/currentTexts`,
    officialMaxRank: sourceMeta.officialMaxRank ?? null,
  };
};

const defs = {};
const define = (heroId, slot, title, maxLevel, build, excluded, pending, proofNote) => {
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
  build(add, addFormula, addEffect);
  const subject = snapshotByRoute.get(`/skills/${skillKey}`);
  assert(subject?.status === 200, `缺少受保护技能主体：${skillKey}`);
  defs[skillKey] = {
    skillKey,
    name: `${heroes[heroId].name}·${title}`,
    maxLevel,
    source: sourceFor(heroId, slot),
    write,
    protectedExisting: {
      subject: true,
      compositionLists: true,
      protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json",
    },
    excluded,
    pending,
    proofs: [
      { type: "root-bound-source", path: `输入包/来源绑定与当前文本.json -> ${heroId}/${slot}` },
      { type: "fixed-source-version", client: SOURCE_VERSION.clientVersion, official: SOURCE_VERSION.officialVersion, build: SOURCE_VERSION.build },
      { type: "cursor-source-review", runId: cursorAudit.runId, verdict: "READY", reviewedPlanRev: cursorAudit.reviewedPlanRev },
    ],
    proofNote,
    currentSubject: clone(subject.data),
  };
};

const skillParam = (heroId, slot, dataName, count, parameterKey, name, valueType, description, sortOrder, transform = value => value) =>
  skill(parameterKey, name, valueType, levelValues(heroId, slot, dataName, count, 1, transform), description, sortOrder);
const fixedData = (heroId, slot, dataName, parameterKey, name, valueType, description, sortOrder, transform = value => value, index = 1) =>
  fixed(parameterKey, name, valueType, transform(dataAt(heroId, slot, dataName, index)), description, sortOrder);
const fixedCoefficient = (heroId, slot, calculationName, parameterKey, name, description, sortOrder, index = 1) =>
  fixed(parameterKey, name, "DECIMAL", coefficient(heroId, slot, calculationName, index), description, sortOrder);
const charBreakpointValues = (heroId, slot, calculationName) => {
  const part = calculationPart(heroId, slot, calculationName, 0);
  assert(typeof part.mLevel1Value === "number", `缺少角色等级起始值：${heroId}/${slot}/${calculationName}`);
  const values = {};
  for (let levelNumber = 1; levelNumber <= 18; levelNumber += 1) {
    let value = part.mLevel1Value;
    for (const breakpoint of part.mBreakpoints || []) {
      if (levelNumber < breakpoint.mLevel) continue;
      if (typeof breakpoint.mAdditionalBonusAtThisLevel === "number") value += breakpoint.mAdditionalBonusAtThisLevel;
    }
    values[String(levelNumber)] = norm(value);
  }
  return values;
};

const addManaIfPublic = (skillKey, addEffect, description) => {
  if (reuseSet.has(`${skillKey}/mana_cost`)) addEffect(resourceEffect("mana", "mana_cost", description));
};
const addManaLevel = (heroId, slot, add, addEffect, description) => {
  const skillKey = `${heroId.toLowerCase()}_${slot.toLowerCase()}`;
  if (reuseSet.has(`${skillKey}/mana_cost`)) {
    addEffect(resourceEffect("mana", "mana_cost", description));
    return;
  }
  if (Array.isArray(spell(heroId, slot).mana)) {
    add(skill("mana_cost", "基础法力消耗", "INTEGER", resourceLevelValues(heroId, slot, "mana", Math.min(5, spell(heroId, slot).mana.length)), "来源资源数组从索引0按技能等级读取；仅记录基础消耗。", 900));
    addEffect(resourceEffect("mana", "mana_cost", description));
  }
};

const noExtra = [];
define("Teemo", "P", "游击队军备", 1, (add, _formula, addEffect) => {
  add(fixedData("Teemo", "P", "StealthCooldownDuration", "stealth_stationary_duration_ms", "进入隐形所需静止时间（毫秒）", "INTEGER", "当前正文@StealthCooldownDuration@为1.5秒；转换为整数毫秒。", 10, toMs));
  add(fixedData("Teemo", "P", "AttackSpeedDuration", "attack_speed_duration_ms", "离开隐形后攻速持续时间（毫秒）", "INTEGER", "当前DataValue为5秒；不采用摘要中的旧3秒。", 20, toMs));
  add(character("attack_speed_ratio", "离开隐形后的额外攻击速度比例", "DECIMAL", charBreakpointValues("Teemo", "P", "BonusAttackSpeed"), "BonusAttackSpeed为角色等级断点：1至4级0.2、5至9级0.4、10至14级0.6、15至18级0.8；比例属性用attribute_flat_add。", 30));
  addEffect(attributeEffect("self_attack_speed", "游击队军备自身额外攻击速度", "attack_speed_ratio", "bonus_attack_speed_percent", "attack_speed_duration_ms", "只定义离开隐形后的自身攻速比例；进入隐形和离开隐形条件由事件层接线。", 20));
}, ["草丛移动保持隐形的持续数值未在当前根中给出，不造固定值。"], ["草丛保持隐形资格需运行事件接线。"], "P只沿TeemoPassive根绑定；当前消费攻击速度持续5秒。");

define("Teemo", "Q", "致盲吹箭", 5, (add, addFormula, addEffect) => {
  add(skillParam("Teemo", "Q", "BaseDamage", 5, "base_damage", "基础魔法伤害", "INTEGER", "BaseDamage索引1至5为80/125/170/215/260；索引0=35不作1级。", 10));
  add(fixedData("Teemo", "Q", "APRatio", "ap_ratio", "法强伤害倍率", "DECIMAL", "来自CalculatedDamage第二个分支APRatio。", 20));
  add(skillParam("Teemo", "Q", "BlindDuration", 5, "blind_duration_ms", "致盲持续时间（毫秒）", "INTEGER", "BlindDuration索引1至5为2/2.25/2.5/2.75/3秒；转换为整数毫秒。", 30, toMs));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Teemo", "Q"), "当前根spellCastTime=0.25秒。", 40));
  addFormula(formula("magic_damage", "致盲吹箭魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "CalculatedDamage=BaseDamage+APRatio×法强。", 10));
  addManaIfPublic("teemo_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["小兵和野怪致盲延长分支（MinionMonsterDurationMod及匿名计算）不录参数。"], ["致盲命中条件由事件层接线。"], "保留当前匿名计算之外的CalculatedDamage本体公式；当前数组按技能等级索引1至5。");

define("Teemo", "W", "小莫快跑", 5, (add, _formula, addEffect) => {
  add(skillParam("Teemo", "W", "PassiveMoveSpeedBonus", 5, "passive_move_speed_ratio", "被动移动速度比例", "DECIMAL", "PassiveMoveSpeedBonus索引1至5为0.12/0.16/0.20/0.24/0.28；比例属性用attribute_flat_add。", 10, value => Number(value)));
  add(fixedData("Teemo", "W", "PassiveCooldownOnDamageTaken", "passive_no_hero_damage_window_ms", "被动未受伤窗口（毫秒）", "INTEGER", "正文当前@PassiveCooldownOnDamageTaken@为5秒；英雄或防御塔伤害资格由事件层接线，塔伤害专用分支不录。", 20, toMs));
  add(skillParam("Teemo", "W", "ActiveMoveSpeedBonus", 5, "active_move_speed_ratio", "主动移动速度比例", "DECIMAL", "ActiveMoveSpeedBonus索引1至5为0.24/0.32/0.40/0.48/0.56；比例属性用attribute_flat_add。", 30));
  add(fixedData("Teemo", "W", "ActiveMoveSpeedBuffDuration", "active_move_speed_duration_ms", "主动移动速度持续时间（毫秒）", "INTEGER", "当前正文持续3秒；转换为整数毫秒。", 40, toMs));
  add(fixed("cast_time_seconds", "施法时间（秒）", "DECIMAL", fixedSeconds("Teemo", "W"), "源spellCastTime=0.5286999940872192秒，毫秒值不是整数，保留原始秒值。", 50));
  addEffect(attributeEffect("passive_move_speed", "小莫快跑被动移动速度", "passive_move_speed_ratio", "move_speed_percent", null, "只定义被动自身比例；进入主动状态时必须先移除被动，主动结束后按未受伤资格恢复；状态切换由事件层接线。", 20));
  addEffect(attributeEffect("active_move_speed", "小莫快跑主动移动速度", "active_move_speed_ratio", "move_speed_percent", "active_move_speed_duration_ms", "只定义主动3秒自身总移动速度比例；主动值是被动值的翻倍态，不与被动叠加；主动结束后按资格恢复被动，状态切换由事件层接线。", 30));
  addManaIfPublic("teemo_w", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["防御塔伤害分支不录单位专用参数。"], ["被动未受英雄伤害、主动受击不移除、主动施放移除被动、主动结束恢复被动等状态资格需事件层接线；未接线不声称完整行为，0.12与0.24不得并存叠加。"], "主动施法时间保留非整数秒；主动移动速度是被动值的翻倍/替代态，状态切换需移除与恢复，不将0.12+0.24写成0.36。");

define("Teemo", "E", "毒性射击", 5, (add, addFormula) => {
  add(skillParam("Teemo", "E", "ImpactBaseDamage", 5, "impact_base_damage", "命中附加基础魔法伤害", "INTEGER", "ImpactBaseDamage索引1至5为9/23/37/51/65；索引0为-5。", 10));
  add(fixedData("Teemo", "E", "ImpactAPRatio", "impact_ap_ratio", "命中法强倍率", "DECIMAL", "ImpactCalculatedDamage中的ImpactAPRatio。", 20));
  add(fixedData("Teemo", "E", "ImpactBonusADRatio", "impact_bonus_ad_ratio", "命中额外攻击力倍率", "DECIMAL", "ImpactCalculatedDamage的mStat=2、mStatFormula=2对应额外攻击力。", 30));
  add(skillParam("Teemo", "E", "TickBaseDamage", 5, "tick_base_damage", "每秒基础魔法伤害", "INTEGER", "TickBaseDamage索引1至5为6/12/18/24/30。", 40));
  add(fixedData("Teemo", "E", "TickAPRatio", "tick_ap_ratio", "每秒法强倍率", "DECIMAL", "TickCalculatedDamage中的TickAPRatio。", 50));
  add(fixedData("Teemo", "E", "TickBonusADRatio", "tick_bonus_ad_ratio", "每秒额外攻击力倍率", "DECIMAL", "TickCalculatedDamage的mStat=2、mStatFormula=2对应额外攻击力。", 60));
  add(fixedData("Teemo", "E", "PoisonDuration", "poison_duration_ms", "毒性持续时间（毫秒）", "INTEGER", "PoisonDuration=4秒，转换为整数毫秒。", 70, toMs));
  add(fixedData("Teemo", "E", "TickFrequency", "tick_interval_ms", "毒性跳动间隔（毫秒）", "INTEGER", "TickFrequency=1秒，转换为整数毫秒。", 80, toMs));
  add(fixed("poison_tick_count", "毒性跳动次数", "INTEGER", 4, "当前正文持续4秒且每秒一跳；TotalDotDamage等于每秒整段×4。", 90));
  addFormula(formula("impact_magic_damage", "毒性射击命中附加魔法伤害", ADD(ADD(P("impact_base_damage"), MUL(P("impact_ap_ratio"), AP())), MUL(P("impact_bonus_ad_ratio"), bonusAD())), "ImpactCalculatedDamage=基础值+法强段+额外攻击力段。", 10));
  addFormula(formula("poison_tick_magic_damage", "毒性射击每秒魔法伤害", ADD(ADD(P("tick_base_damage"), MUL(P("tick_ap_ratio"), AP())), MUL(P("tick_bonus_ad_ratio"), bonusAD())), "TickCalculatedDamage=基础值+法强段+额外攻击力段。", 20));
  addFormula(formula("total_poison_magic_damage", "毒性射击全程魔法伤害", MUL(ADD(ADD(P("tick_base_damage"), MUL(P("tick_ap_ratio"), AP())), MUL(P("tick_bonus_ad_ratio"), bonusAD())), P("poison_tick_count")), "当前消费TotalDotDamage=TickCalculatedDamage×PoisonDuration；按4秒每秒一跳表达为每秒整段×4，重命中不凭空叠加。", 30));
}, ["野怪1.6倍伤害分支不录MonsterMod及匿名计算。"], ["攻击特效命中与毒性刷新事件需运行层接线；重命中刷新不等于无证叠加。"], "当前树同时消费ImpactCalculatedDamage与tooltipOnly的TotalDotDamage；额外攻击力段不可遗漏。");

define("Teemo", "R", "种蘑菇", 3, () => {}, ["蘑菇陷阱、触发爆炸、持续伤害、减速、弹跳和充能链全部按范围排除。"], ["只保留公共参数之外的本体施放接线待主负责人决定；不造陷阱对象。"], "R的TotalDamage虽有当前树，但属于陷阱链，范围内不生成数值节点。");

define("Shaco", "P", "背刺", 1, (add, addFormula) => {
  add(runtime("backstab_base_damage", "背刺普攻基础伤害（实际角色等级输入）", "DECIMAL", "BasicAttackDamage的20至35角色等级插值曲线未证，运行层必须提供实际值，不设默认。", 10));
  add(fixedData("Shaco", "P", "AttackBonusADRatio", "backstab_bonus_ad_ratio", "背刺普攻额外攻击力倍率", "DECIMAL", "BasicAttackDamage中mStat=2、mStatFormula=2的AttackBonusADRatio。", 20));
  add(runtime("shivs_base_damage", "背刺E额外基础伤害（实际角色等级输入）", "DECIMAL", "ShivDamage的15至50角色等级插值曲线未证，运行层必须提供实际值，不设默认。", 30));
  add(fixed("shivs_ap_ratio", "背刺E法强倍率", "DECIMAL", coefficient("Shaco", "P", "ShivDamage", 1), "ShivDamage第二个分支为mCoefficient=0.1法强；沿窄证命名为法强。", 40));
  add(fixedData("Shaco", "P", "ShivExecuteDamagePercent", "shivs_execute_multiplier", "背刺E斩杀倍率", "DECIMAL", "ShivDamageExecute完整树将ShivDamage乘以1.5。", 50));
  add(fixed("execute_health_threshold_ratio", "背刺E斩杀生命阈值比例", "DECIMAL", 0.3, "当前被动正文明确目标低于30%生命值；阈值条件由事件层接线。", 60));
  addFormula(formula("backstab_basic_attack_physical_damage", "背刺普攻附加物理伤害", ADD(P("backstab_base_damage"), MUL(P("backstab_bonus_ad_ratio"), bonusAD())), "BasicAttackDamage=角色等级插值基础值+0.2×额外攻击力。", 10));
  addFormula(formula("backstab_shiv_magic_damage", "背刺E附加魔法伤害", ADD(P("shivs_base_damage"), MUL(P("shivs_ap_ratio"), AP())), "ShivDamage=角色等级插值基础值+0.1×法强。", 20));
  addFormula(formula("backstab_shiv_execute_magic_damage", "背刺E斩杀附加魔法伤害", MUL(ADD(P("shivs_base_damage"), MUL(P("shivs_ap_ratio"), AP())), P("shivs_execute_multiplier")), "ShivDamageExecute=完整ShivDamage×1.5；不是只乘基础段。", 30));
}, ["怪物暴击和分身倍率不录。", "未消费的每目标3秒冷却、旧-40%慢速字段不录。"], ["背后方向资格、普攻和E的跨槽命中资格、低于30%阈值事件需接线。", "两段角色等级插值曲线未证，使用无默认实际输入。"], "被动正文同时消费BasicAttackDamage、ShivDamage和ShivDamageExecute；E斩杀整段乘算。");

define("Shaco", "Q", "欺诈魔术", 5, (add, addFormula, addEffect) => {
  add(skillParam("Shaco", "Q", "StealthDuration", 5, "stealth_duration_ms", "隐形持续时间（毫秒）", "INTEGER", "StealthDuration索引1至5为2.5/2.75/3/3.25/3.5秒；转换为整数毫秒。", 10, toMs));
  add(skillParam("Shaco", "Q", "BaseDamage", 5, "enhanced_attack_base_damage", "强化攻击附加基础物理伤害", "INTEGER", "TotalDamage的BaseDamage索引1至5为25/35/45/55/65；索引0=15不作1级。", 20));
  add(fixedData("Shaco", "Q", "BonusADRatio", "enhanced_attack_bonus_ad_ratio", "强化攻击额外攻击力倍率", "DECIMAL", "TotalDamage的mStat=2、mStatFormula=2对应额外攻击力。", 30));
  add(fixedData("Shaco", "Q", "NonCritBackstabMod", "backstab_crit_coefficient", "背刺暴击修正系数", "DECIMAL", "QCritDamageMod完整树中的NonCritBackstabMod=0.6。", 40));
  add(fixed("crit_baseline", "暴击倍率基准", "DECIMAL", 1, "QCritDamageMod树中的固定1。", 50));
  add(fixed("crit_minus_one", "暴击统计减一", "INTEGER", -1, "QCritDamageMod树中的固定-1。", 60));
  add(runtime("actual_critical_damage_multiplier", "实际总暴击倍率（mStat9）", "DECIMAL", "QCritDamageMod的mStat9未扩展为属性枚举；运行层提供实际总暴击倍率，不设默认。", 70));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Shaco", "Q"), "当前根spellCastTime=0.25秒。", 80));
  addFormula(formula("enhanced_attack_physical_damage", "欺诈魔术强化攻击附加物理伤害", ADD(P("enhanced_attack_base_damage"), MUL(P("enhanced_attack_bonus_ad_ratio"), bonusAD())), "TotalDamage=基础值+0.6×额外攻击力。", 10));
  addFormula(formula("backstab_critical_multiplier", "欺诈魔术背刺暴击倍率", ADD(P("crit_baseline"), MUL(P("backstab_crit_coefficient"), ADD(P("actual_critical_damage_multiplier"), P("crit_minus_one")))), "QCritDamageMod=1+0.6×(实际mStat9总暴击倍率−1)。", 20));
  addFormula(formula("backstab_critical_full_attack_physical_damage", "欺诈魔术背刺暴击整段物理伤害", MUL(ADD(P("crit_baseline"), MUL(P("backstab_crit_coefficient"), ADD(P("actual_critical_damage_multiplier"), P("crit_minus_one")))), ADD(totalAD(), ADD(P("enhanced_attack_base_damage"), MUL(P("enhanced_attack_bonus_ad_ratio"), bonusAD())))), "背后首次攻击会暴击；本公式包含本次基础普攻总攻击力一次和Q强化附加伤害，Q公式不自动包含P背刺或其他附伤；接线时避免再次叠加总攻击力。", 30));
  addManaIfPublic("shaco_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["伪施法0.125秒、额外普攻时间0.25秒和CDRefund2.5不被当前消费，不录。", "显示距离400不写成通用原始25000。"], ["W/R不破隐形和背后必暴击资格需事件层接线；mStat9实际值必填。", "完整攻击公式包含本次基础普攻一次；P背刺与其他附伤由各自资格单独接线，不能重复叠加总攻击力。"], "保留QCritDamageMod与完整攻击段；完整段含本次基础普攻总攻击力一次和Q附加伤害，不自动包含P背刺或其他附伤，接线防重复总AD。");

define("Shaco", "W", "惊吓魔盒", 5, () => {}, ["盒子陷阱、恐惧、持续攻击、单目标与野怪分支全部排除。"], ["盒子完整链按范围排除，不生成盒子对象、单位专用参数或资源参数。"], "W完整盒子链按范围排除，不保留独立法力消耗；公共复用不包含该技能。");

define("Shaco", "E", "双面毒刃", 5, (add, addFormula, addEffect) => {
  add(skillParam("Shaco", "E", "BaseDamage", 5, "base_damage", "主动魔法伤害基础值", "INTEGER", "TotalDamage的BaseDamage索引1至5为70/95/120/145/170；索引0=45。", 10));
  add(fixedData("Shaco", "E", "BonusADRatio", "bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", "TotalDamage的mStat=2、mStatFormula=2对应额外攻击力。", 20));
  add(fixedData("Shaco", "E", "APRatio", "ap_ratio", "法强倍率", "DECIMAL", "TotalDamage中的APRatio。", 30));
  add(fixedData("Shaco", "E", "ExecuteHealthThreshold", "execute_health_threshold_ratio", "斩杀生命阈值比例", "DECIMAL", "ExecuteHealthThreshold索引1为0.3；作为低于30%条件输入。", 40));
  add(fixedData("Shaco", "E", "ExecuteDamagePercent", "execute_multiplier", "斩杀整段倍率", "DECIMAL", "TotalExecuteDamage完整树将TotalDamage乘以1.5。", 50));
  add(skillParam("Shaco", "E", "SlowAmount", 5, "slow_percent_points", "减速百分数点", "DECIMAL", "SlowAmount为负的内部减速比例，取绝对值后记录20/22.5/25/27.5/30百分数点。", 60, value => Math.abs(Number(value)) * 100));
  add(fixedData("Shaco", "E", "SlowDurationPassive", "passive_slow_duration_ms", "被动减速持续时间（毫秒）", "INTEGER", "被动慢速持续2秒。", 70, toMs));
  add(fixedData("Shaco", "E", "SlowDurationActive", "active_slow_duration_ms", "主动减速持续时间（毫秒）", "INTEGER", "主动慢速持续3秒。", 80, toMs));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Shaco", "E"), "当前根spellCastTime=0.25秒。", 90));
  addFormula(formula("magic_damage", "双面毒刃主动魔法伤害", ADD(ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), MUL(P("ap_ratio"), AP())), "TotalDamage=基础值+0.8×额外攻击力+0.6×法强。", 10));
  addFormula(formula("execute_magic_damage", "双面毒刃斩杀魔法伤害", MUL(ADD(ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), MUL(P("ap_ratio"), AP())), P("execute_multiplier")), "TotalExecuteDamage=完整TotalDamage×1.5。", 20));
  addManaIfPublic("shaco_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["目标类别、野怪专用分支不录；不生成单位排除参数。"], ["被动攻击减速只在E不冷却时生效；主动与被动减速、P背刺跨槽资格需事件层接线。"], "斩杀按完整TotalDamage乘1.5，减速内部负值转换为百分数点仅用于效果数值展示。");

define("Shaco", "R", "幻像", 3, (add, _formula, addEffect) => {
  add(fixedData("Shaco", "R", "TeleportRange", "teleport_range", "本体传送范围", "INTEGER", "TeleportRange=150，仅作为位移范围证据，不推断伤害免疫。", 10));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Shaco", "R"), "当前根spellCastTime=0.25秒；不替代暂时消失持续。", 20));
  addManaIfPublic("shaco_r", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["分身18秒、分身攻击倍率、死亡爆炸、小盒子和控制链全部排除。"], ["本体暂时消失再出现的时序保留资格，但根没有消失持续；不把施法时间当不可选取时长。"], "TeleportRange只录原始范围字段；不把分身输出误归入本体伤害。");

define("Heimerdinger", "P", "海克斯科技亲和", 1, (add, _formula, addEffect) => {
  add(fixedData("Heimerdinger", "P", "MovementSpeed", "near_turret_move_speed_ratio", "炮台或友方防御塔附近移动速度比例", "DECIMAL", "MovementSpeed=0.2；比例属性使用attribute_flat_add。", 10));
  addEffect(attributeEffect("near_turret_move_speed", "海克斯科技亲和自身移动速度", "near_turret_move_speed_ratio", "move_speed_percent", null, "只定义自身20%移动速度比例；进入或离开自身炮台/友方防御塔近距资格由事件层接线，离开合资格近距时必须移除。", 20));
}, ["炮台和友方防御塔是触发资格，不生成虚拟炮台或建筑单位。"], ["靠近自身炮台或友方防御塔时才施加，离开合资格近距必须移除；资格需运行层接线，不能当永久加速或制造炮台。"], "自身20%数值保留；依赖独立单位/建筑的近距进入与离开资格、移除时点分开记录。");

define("Heimerdinger", "Q", "H-28 G进化炮台", 5, () => {}, ["独立炮台主体、生命、攻击、光束和充能链全部排除。"], ["炮台配置、生命、攻击与消耗链均按范围排除；不生成炮台单位。"], "Q完整炮台链按范围排除，不保留炮台配置、法力消耗参数或效果。");

define("Heimerdinger", "W", "海克斯科技微型导弹", 5, (add, addFormula, addEffect) => {
  add(skillParam("Heimerdinger", "W", "BaseDamage", 5, "initial_base_damage", "首颗导弹基础魔法伤害", "INTEGER", "Damage的BaseDamage索引1至5为50/75/100/125/150；首颗命中。", 10));
  add(fixedData("Heimerdinger", "W", "InitialDamageAPRatio", "initial_ap_ratio", "首颗导弹法强倍率", "DECIMAL", "Damage中的InitialDamageAPRatio=0.55。", 20));
  add(skillParam("Heimerdinger", "W", "ExtraHitBaseDamage", 5, "following_base_damage", "同一目标后续每颗基础魔法伤害", "INTEGER", "ExtraHitDamage的ExtraHitBaseDamage索引1至5为10/15/20/25/30；同一目标连续命中。", 30));
  add(fixedCoefficient("Heimerdinger", "W", "ExtraHitDamage", "following_ap_ratio", "后续导弹法强倍率", "ExtraHitDamage的mCoefficient=0.12。", 40));
  add(skillParam("Heimerdinger", "W", "TotalBaseDamage", 5, "all_five_base_damage", "五颗全部命中基础魔法伤害", "INTEGER", "当前TotalDamage消费TotalBaseDamage索引1至5为90/135/180/225/270；不从未消费字段任意拼接。", 50));
  add(fixedCoefficient("Heimerdinger", "W", "TotalDamage", "all_five_ap_ratio", "五颗全部命中法强倍率", "当前TotalDamage消费的mCoefficient=1.03。", 60));
  add(fixedData("Heimerdinger", "W", "Rockets", "missile_count", "导弹数量", "INTEGER", "当前正文明确5颗；仅用于同一技能重复命中边界。", 70));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Heimerdinger", "W"), "当前根spellCastTime=0.25秒。", 80));
  addFormula(formula("initial_magic_damage", "微型导弹首颗魔法伤害", ADD(P("initial_base_damage"), MUL(P("initial_ap_ratio"), AP())), "Damage=首颗基础值+0.55×法强。", 10));
  addFormula(formula("following_magic_damage", "微型导弹同目标后续魔法伤害", ADD(P("following_base_damage"), MUL(P("following_ap_ratio"), AP())), "ExtraHitDamage=同一目标后续每颗基础值+0.12×法强。", 20));
  addFormula(formula("all_five_magic_damage", "微型导弹五颗全部命中魔法伤害", ADD(P("all_five_base_damage"), MUL(P("all_five_ap_ratio"), AP())), "当前TotalDamage=五颗全部命中基础值+1.03×法强；首颗与后续命中资格由事件层接线。", 30));
  addManaIfPublic("heimerdinger_w", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["小兵和野怪额外倍率、炮台充能收益不录单位专用参数。", "显示射程1325不写成通用原始25000。"], ["同一目标后续命中次数和每颗命中事件需运行层接线；五颗总值只按当前消费TotalDamage记录。"], "首颗、同目标后续和当前五颗总值分别取当前树，避免把额外目标或旧字段混入。");

define("Heimerdinger", "E", "CH-2电子风暴手雷", 5, (add, addFormula, addEffect) => {
  add(skillParam("Heimerdinger", "E", "BaseDamage", 5, "base_damage", "魔法伤害基础值", "INTEGER", "Damage的BaseDamage索引1至5为60/100/140/180/220；索引0=20。", 10));
  add(fixedCoefficient("Heimerdinger", "E", "Damage", "ap_ratio", "法强倍率", "Damage的mCoefficient=0.6。", 20));
  add(fixedData("Heimerdinger", "E", "SlowPercent", "slow_percent_points", "减速百分数点", "DECIMAL", "SlowPercent=0.35，转换为35百分数点。", 30, value => Number(value) * 100));
  add(fixedData("Heimerdinger", "E", "SlowDuration", "slow_duration_ms", "减速持续时间（毫秒）", "INTEGER", "SlowDuration=2秒。", 40, toMs));
  add(fixedData("Heimerdinger", "E", "StunDuration", "stun_duration_ms", "中心眩晕持续时间（毫秒）", "INTEGER", "StunDuration=1.5秒。", 50, toMs));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Heimerdinger", "E"), "当前根spellCastTime=0.25秒。", 60));
  addFormula(formula("magic_damage", "电子风暴手雷魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "Damage=基础值+0.6×法强。", 10));
  addManaIfPublic("heimerdinger_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["炮台满充能收益不录；不生成炮台事件。"], ["中心同一敌人命中、减速和眩晕区域资格需事件层接线。"], "中心眩晕是本体命中资格，保留1.5秒；不因炮台联动而排除E伤害和控制。");

define("Heimerdinger", "R", "升级！！！", 3, (add, addFormula, addEffect) => {
  add(fixed("cast_time_seconds", "施法时间（秒）", "DECIMAL", fixedSeconds("Heimerdinger", "R"), "源spellCastTime=0.3812499940395355秒，毫秒值不是整数，保留原始秒值。", 10));
  add(skillParam("Heimerdinger", "R", "WUltBaseDamage", 3, "rw_initial_base_damage", "强化W首段基础魔法伤害", "INTEGER", "WUltDamage消费WUltBaseDamage索引1至3为135/180/225；不是每波总值。", 20));
  add(fixedCoefficient("Heimerdinger", "R", "WUltDamage", "rw_initial_ap_ratio", "强化W首段法强倍率", "WUltDamage当前消费的mCoefficient=0.45。", 30));
  add(skillParam("Heimerdinger", "R", "WUltTotalBaseDamage", 3, "rw_total_base_damage", "强化W当前最大伤害基础值", "DECIMAL", "WUltTotalDamage消费WUltTotalBaseDamage索引1至3为503/697.5/892。", 40));
  add(fixedCoefficient("Heimerdinger", "R", "WUltTotalDamage", "rw_total_ap_ratio", "强化W当前最大伤害法强倍率", "WUltTotalDamage当前消费的mCoefficient=1.83。", 50));
  add(fixed("rw_wave_count", "强化W波数", "INTEGER", 4, "当前正文明确发射4波；额外导弹减伤和兵野分支不录。", 60));
  add(skillParam("Heimerdinger", "R", "EUltBaseDamage", 3, "re_discharge_base_damage", "强化E单次放电基础魔法伤害", "INTEGER", "EUltDamage消费EUltBaseDamage索引1至3为100/200/300；同一目标命中次数未证。", 70));
  add(fixedCoefficient("Heimerdinger", "R", "EUltDamage", "re_ap_ratio", "强化E单次放电法强倍率", "EUltDamage当前消费的mCoefficient=0.6。", 80));
  add(runtime("re_same_target_discharge_count", "强化E同一目标放电命中次数", "INTEGER", "正文虽写放电3次，但同一目标实际可命中次数未证；运行层必须提供实际次数，不默认3。", 90));
  addFormula(formula("rw_initial_magic_damage", "升级导弹集群首段魔法伤害", ADD(P("rw_initial_base_damage"), MUL(P("rw_initial_ap_ratio"), AP())), "当前WUltDamage=强化W首段基础值+0.45×法强。", 10));
  addFormula(formula("rw_total_magic_damage", "升级导弹集群当前最大魔法伤害", ADD(P("rw_total_base_damage"), MUL(P("rw_total_ap_ratio"), AP())), "当前WUltTotalDamage=已消费最大值基础段+1.83×法强；不把旧次段拼入。", 20));
  addFormula(formula("re_single_discharge_magic_damage", "强化闪电手雷单次放电魔法伤害", ADD(P("re_discharge_base_damage"), MUL(P("re_ap_ratio"), AP())), "当前EUltDamage=单次放电基础值+0.6×法强。", 30));
  addFormula(formula("re_same_target_total_magic_damage", "强化闪电手雷同一目标总魔法伤害", MUL(ADD(P("re_discharge_base_damage"), MUL(P("re_ap_ratio"), AP())), P("re_same_target_discharge_count")), "按运行层提供的同一目标实际放电命中次数计算；不把正文3次直接当同目标总次数。", 40));
  addManaIfPublic("heimerdinger_r", addEffect, "复用冻结公共法力参数；升级技能无消耗由资格说明保留。");
}, ["RQ炮台及炮台生命、护甲、魔抗、常规/满能量射击排除。", "旧WUltExtraHitBaseDamage、WUltSecondaryBaseDamage及匿名减伤树不录。"], ["R只强化下一次非终极技能；RE同一目标命中次数无默认；升级消耗免除和重施取消需事件层接线。"], "R不是完整角色变形；仅保留当前消费RW首段/总值与RE单次值，保留非整数秒施法时间。");

define("Zyra", "P", "荆棘花园", 1, () => {}, ["种子生成、植物生成和独立植物攻击链全部排除。", "旧被动通用法力70、冷却8和施法0.25不当作可施放本体技能。"], ["SeedCooldown的13.6至9.05角色等级插值未知，不录默认。"], "P是种子和植物链，范围内不制造虚拟单位或充能事件。");

define("Zyra", "Q", "致命棘刺", 5, (add, addFormula, addEffect) => {
  add(skillParam("Zyra", "Q", "BaseDamage", 5, "base_damage", "本体魔法伤害基础值", "INTEGER", "InitialDamage当前消费BaseDamage索引1至5为60/100/140/180/220；索引0虽为60但不作1级。", 10));
  add(fixedCoefficient("Zyra", "Q", "InitialDamage", "ap_ratio", "法强倍率", "InitialDamage当前消费的mCoefficient=0.65。", 20));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Zyra", "Q"), "当前根spellCastTime=0.25秒。", 30));
  addFormula(formula("magic_damage", "致命棘刺本体魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "当前正文消费tooltipOnly的InitialDamage=基础值+0.65×法强。", 10));
  addManaIfPublic("zyra_q", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["种子转植物和植物攻击链排除；不生成植物参数。"], ["本体命中和种子附近资格需事件层接线。"], "tooltipOnly的InitialDamage是当前正文唯一本体伤害消费者，不能因tooltipOnly标签排除。");

define("Zyra", "W", "狂野生长", 5, () => {}, ["种子、充能、击杀返还和纯视野完整链排除。", "源spellCastTime=0且mCastTime=0.24320000410079956不替代本体施法记录。"], ["不创建没有植物前提的击杀充能返还事件。"], "W是种子/充能辅助技能，范围内无可独立录入的本体伤害或属性节点。");

define("Zyra", "E", "缠绕之根", 5, (add, addFormula, addEffect) => {
  add(skillParam("Zyra", "E", "BaseDamage", 5, "base_damage", "本体魔法伤害基础值", "INTEGER", "TotalDamage当前消费BaseDamage索引1至5为60/95/130/165/200；索引0=25。", 10));
  add(fixedCoefficient("Zyra", "E", "TotalDamage", "ap_ratio", "法强倍率", "TotalDamage当前消费的mCoefficient=0.6。", 20));
  add(skillParam("Zyra", "E", "RootDuration", 5, "root_duration_ms", "禁锢持续时间（毫秒）", "INTEGER", "RootDuration索引1至5为1/1.25/1.5/1.75/2秒；索引0=0.75不作1级。", 30, toMs));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Zyra", "E"), "当前根spellCastTime=0.25秒。", 40));
  addFormula(formula("magic_damage", "缠绕之根本体魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "当前正文消费TotalDamage=基础值+0.6×法强。", 10));
  addManaIfPublic("zyra_e", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["种子转植物、植物攻击和植物30%减速/2秒/最多两层排除。"], ["本体藤蔓命中、禁锢资格需事件层接线；植物慢速不冒充本体E控制。"], "只保留本体伤害与禁锢；RootDuration按DataValue索引1至5读取。");

define("Zyra", "R", "绞杀之藤", 3, (add, addFormula, addEffect) => {
  add(skillParam("Zyra", "R", "BaseDamage", 3, "base_damage", "密林本体基础魔法伤害", "INTEGER", "TotalDamage当前消费BaseDamage索引1至3为200/300/400；索引0亦为200但不作未学R默认。", 10));
  add(fixedCoefficient("Zyra", "R", "TotalDamage", "ap_ratio", "法强倍率", "TotalDamage当前消费的mCoefficient=0.7。", 20));
  add(fixed("knockup_delay_ms", "击飞前延迟（毫秒）", "INTEGER", 2000, "当前正文明确2秒后击飞；这是命中后延迟，不是施法时间。", 30));
  add(fixedData("Zyra", "R", "KnockupDuration", "knockup_duration_ms", "击飞持续时间（毫秒）", "INTEGER", "KnockupDuration=1秒，转换为整数毫秒。", 40, toMs));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", fixedTimeMs("Zyra", "R"), "当前根spellCastTime=0.25秒；不与击飞延迟混淆。", 50));
  addFormula(formula("magic_damage", "绞杀之藤本体魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "当前正文消费tooltipOnly的TotalDamage=基础值+0.7×法强。", 10));
  addManaIfPublic("zyra_r", addEffect, "复用冻结公共法力参数；仅记录基础消耗。");
}, ["植物激怒、重置寿命、增加50%生命和50%伤害排除；不影响密林本体。"], ["密林区域命中、2秒后击飞事件需运行层接线。"], "婕拉R密林是本体伤害与控制载体，保留TotalDamage、延迟和击飞；植物增益单独排除。");

const order = [
  "teemo_p", "teemo_q", "teemo_w", "teemo_e", "teemo_r",
  "shaco_p", "shaco_q", "shaco_w", "shaco_e", "shaco_r",
  "heimerdinger_p", "heimerdinger_q", "heimerdinger_w", "heimerdinger_e", "heimerdinger_r",
  "zyra_p", "zyra_q", "zyra_w", "zyra_e", "zyra_r",
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
  sourceFiles.push({ path: `hero45-root-entry-20260910/${item.path}`, role: item.role, sha256: actual, byteSize: fs.statSync(file).size });
}
for (const [relative, file, role] of [
  ["来源绑定与当前文本.json", bindingFile, "当前绑定与原始对象索引"],
  ["输入版本.json", versionFile, "输入版本"],
  ["主负责人范围与核对要求.md", rangeFile, "主负责人范围要求"],
  ["主负责人源值核对说明.md", sourceNoteFile, "主负责人源值核对"],
  ["README.md", inputReadmeFile, "输入说明"],
]) sourceFiles.push({ path: `hero45-root-entry-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });
for (const [relative, file, role] of [
  ["Cursor来源复核结论.md", cursorConclusionFile, "Cursor来源复核结论"],
  ["主负责人执行审计.json", cursorAuditFile, "Cursor执行审计元数据"],
]) sourceFiles.push({ path: `hero45-cursor-review-run-20260910/${relative}`, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });

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
    scope: "提莫、萨科、黑默丁格、婕拉20个技能槽；唯一敌方范围。保留范围内本体伤害、控制、隐身、自身属性与基础资源；独立召唤物、陷阱、兵野建筑专用分支和纯视野排除。",
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
      conclusionFile: ".agents/artifacts/hero45-cursor-review-run-20260910/Cursor来源复核结论.md",
      conclusionSha256: hashes.cursorConclusionSha256,
      auditFile: ".agents/artifacts/hero45-cursor-review-run-20260910/主负责人执行审计.json",
      auditSha256: hashes.cursorAuditSha256,
      verdict: "READY",
      runId: cursorAudit.runId,
      requestId: cursorAudit.requestId,
      events: cursorAudit.events,
      uniqueTools: cursorAudit.uniqueTools,
      inputsChecked: cursorAudit.inputsChecked,
      apiWrites: cursorAudit.apiWrites,
      gitDelta: cursorAudit.gitDelta.length,
      reviewedPlanRev: cursorAudit.reviewedPlanRev,
      note: "主负责人逐槽核对说明作为当前消费优先依据；本候选未调用业务接口。",
    },
    inputPackage: ".agents/artifacts/hero45-root-entry-20260910",
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
  },
  protectedObjects: {
    snapshot: "输入包/参考资料/当前20槽保护快照.json",
    snapshotSha256: hashes.protectionSnapshotSha256,
    inputGETs: protection.GETs,
    requestCount: protection.requests.length,
    routes: protectedRouteHashes,
    publicReuse: clone(reusedPublicParameters),
    note: "194条只读保护覆盖字典、角色、关系、20个技能主体及组成列表；22项公共参数只读复用。",
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
  sourceReviewVerdict: "READY",
  fixedVersions: SOURCE_VERSION,
  globalScope: {
    included: ["本体伤害与控制", "同一敌人的连续命中", "自身隐身与属性收益", "本体基础资源消耗", "当前消费的匿名或tooltipOnly公式"],
    excluded: ["独立召唤物和陷阱", "兵野与建筑专用分支", "额外敌人分配", "纯视野", "未证实际插值或同目标命中次数"],
    unknownPolicy: "未知曲线、实际命中次数、目标资格和事件时序用无默认运行输入或待接线说明，不用0占位。",
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
if (requests.length !== candidate.counts.newTotal) throw new Error("POST计划数量与候选数量不符");
const candidateBytes = jsonBytes(candidate);
const candidateSha256 = sha256(candidateBytes);
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
  counts: clone(candidate.counts),
  requestCount: requests.length,
  sourceMath: "独立数学核算.mjs",
  sourceMathStatus: "脚本已生成，待执行",
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
  counts: clone(candidate.counts),
  requestCount: requests.length,
  inputGETs: inputVersion.GETs,
  reusedPublicParameters: reusedPublicParameters.length,
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
  noApiCalls: true,
  apiWrites: 0,
};
const readme = [
  "# 第四十五批候选修订一",
  "",
  "本目录由初版候选复制后修订，固定使用客户端16.17、官方资料16.17.1、当前根绑定正文和原始计算树；只写入候选与计划，没有调用业务接口、数据库或浏览器，也没有Git写入。",
  "",
  "本修订覆盖提莫、萨科、黑默丁格、婕拉20个技能槽。194条只读输入保护和22项公共参数复用保持不变。新建内容为82个参数、23个公式、15个效果、0个过程、0个内部状态、0个触发规则，共120项；加22项公共参数后计划总数为142项。",
  "",
  "萨科W盒子完整链和黑默丁格Q炮台完整链均排除，资源参数与效果随整体范围删除。黑默丁格P的自身20%移速仍保留，但只在靠近合资格的自身炮台或友方防御塔时生效，离开近距必须移除，不当作永久加速，也不制造炮台。",
  "",
  "提莫W分别保留被动和主动两个效果，但主动值是被动值的翻倍替代态：0.12与0.24不能同时叠成0.36。状态切换需移除被动、施加主动，主动结束后按被动资格恢复；事件尚未接线，候选不宣称完整行为。",
  "",
  "萨科Q的完整攻击公式继续保留，包含本次基础普攻总攻击力一次和Q强化附加伤害；它不自动包含萨科P背刺或其他附伤，接线时避免重复叠加总攻击力。",
  "",
  "公式全部为二元操作。比例属性使用attribute_flat_add；非整数毫秒施法时间保留原始秒值；未知插值、命中次数、资格和时序使用无默认运行输入或待接线说明，不以0占位。独立数学脚本从冻结输入独立计算期望侧和候选实际侧，逐公式提供两个场景，并检查缺值拒绝、完整等级、数组索引、整数毫秒、效果最终倍率和比例属性乘区。",
  "",
  "本目录内容是静态候选证据，不表示真实数据库回读、运行时、页面或战斗已完成。文件关系、源值与散列见同目录JSON文件。",
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
}

const manifest = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  files: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, { sha256: sha256(bytes), byteSize: bytes.length }])),
  sourceHashes: hashes,
  noApiCalls: true,
  apiWrites: 0,
};
writeJson(path.join(ROOT, "文件散列.json"), manifest);

console.log(JSON.stringify({
  candidateSha256,
  planSha256,
  scopeSha256,
  sourceValuesSha256,
  counts: candidate.counts,
  requestCount: requests.length,
  protectedCompositionCount,
  root: ROOT,
  apiCalls: 0,
  apiWrites: 0,
}, null, 2));
