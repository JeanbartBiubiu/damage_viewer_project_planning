import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero41-root-entry-20260910");
const DURABLE = path.resolve("C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十一批");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "第四十一批巴德米利欧洛烈娜塔";
const REVISION = "hero41-source-v1-luna-candidate";
const SOURCE_VERSION = { clientVersion: "16.17", officialVersion: "16.17.1", build: "16.17.8104348+branch.releases-16-17.content.release" };
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, "utf8"); };
const writeJson = (file, value) => write(file, JSON.stringify(value, null, 2) + "\n");
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const norm = value => Math.abs(Number(value)) < 1e-7 ? 0 : Number(Number(value).toFixed(10));
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const versionFile = path.join(INPUT, "输入版本.json");
const rangeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const sourceNoteFile = path.join(INPUT, "主负责人源值核对说明.md");
const supplementFile = path.join(INPUT, "Cursor复核后补充.md");
const snapshotFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const snapshot = readJson(snapshotFile);
const reuseList = readJson(reuseFile);
const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const reuseSet = new Set(reuseList.map(item => item.skillKey + "/" + item.parameterKey));
const snapByRoute = new Map((snapshot.requests || []).map(item => [item.route, item]));
const reviewDir = path.resolve(ROOT, "..", "hero41-cursor-review-run-20260910");
const reviewAudit = readJson(path.join(reviewDir, "主负责人执行审计.json"));
const sourceReview = {
  conclusionFile: ".agents/artifacts/hero41-cursor-review-run-20260910/Cursor来源复核结论.md",
  conclusionSha256: shaFile(path.join(reviewDir, "Cursor来源复核结论.md")),
  auditFile: ".agents/artifacts/hero41-cursor-review-run-20260910/主负责人执行审计.json",
  auditSha256: shaFile(path.join(reviewDir, "主负责人执行审计.json")),
  inputManifestFile: ".agents/artifacts/hero41-cursor-review-run-20260910/path-signatures-before.json",
  inputManifestSha256: shaFile(path.join(reviewDir, "path-signatures-before.json")),
  verdict: "READY",
  runId: reviewAudit.runId,
  requestId: reviewAudit.requestId,
  events: reviewAudit.events,
  uniqueTools: reviewAudit.uniqueTools,
  apiWrites: reviewAudit.apiWrites,
  gitDelta: reviewAudit.gitDelta,
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
  ["Cursor复核后补充.md", supplementFile],
  ["参考资料/当前20槽保护快照.json", snapshotFile],
]) sourceFiles[pair[0]] = { sha256: shaFile(pair[1]), byteSize: fs.statSync(pair[1]).size };

const spell = (heroId, slot) => {
  const skill = sourceSkills[heroId] && sourceSkills[heroId][slot];
  assert(skill, "缺少源技能：" + heroId + "/" + slot);
  return skill.object.mSpell;
};
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot).DataValues || []).find(item => item.name === name);
  assert(row && Array.isArray(row.values), "缺少DataValue：" + heroId + "/" + slot + "/" + name);
  return row.values;
};
const at = (heroId, slot, name, index) => dataRow(heroId, slot, name)[index === undefined ? 1 : index];
const skillValues = (heroId, slot, name, max, transform) => {
  const values = dataRow(heroId, slot, name);
  assert(values.length >= max + 1, "等级数组长度不足：" + heroId + "/" + slot + "/" + name);
  const fn = transform || (value => value);
  return Object.fromEntries(Array.from({ length: max }, (_, i) => [String(i + 1), norm(fn(values[i + 1]))]));
};
const sourceFixed = (heroId, slot, name, index, transform) => norm((transform || (value => value))(at(heroId, slot, name, index)));
const rawCalc = (heroId, slot, name) => {
  const value = spell(heroId, slot).mSpellCalculations && spell(heroId, slot).mSpellCalculations[name];
  assert(value, "缺少计算树：" + heroId + "/" + slot + "/" + name);
  return value;
};
const rawPart = (heroId, slot, calcName, index) => {
  const value = rawCalc(heroId, slot, calcName).mFormulaParts[index || 0];
  assert(value, "缺少计算树分支：" + heroId + "/" + slot + "/" + calcName);
  return value;
};
const toMs = seconds => {
  const ms = Number(seconds) * 1000;
  const value = Math.round(ms);
  assert(Number.isFinite(ms) && Math.abs(ms - value) < 0.1 && value >= 0, "时间不是非负整数毫秒：" + seconds);
  return value;
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
    hero: heroId, heroName: hero.name, heroKey: hero.key, slot,
    resourceType: hero.source.resourceType, rootPath: hero.rootPath,
    spellPath: meta.binding, bindingAvailable: meta.bindingAvailable,
    clientFile: "参考资料/客户端原文/" + heroId + ".json.gz",
    clientSha256: shaFile(clientFile), clientCompressedSha256: hero.source.client.compressedSha256,
    clientBuild: hero.source.client.contentVersion,
    officialZhFile: "参考资料/官方中文/" + heroId + ".json",
    officialZhSha256: shaFile(zhFile),
    officialEnFile: "参考资料/官方英文/" + heroId + ".json",
    officialEnSha256: shaFile(enFile),
    currentBoundText: clone(meta.currentTexts),
    raw: {
      dataValues: Object.fromEntries((sp.DataValues || []).map(row => [row.name, row.values ? clone(row.values) : null])),
      calculations: clone(sp.mSpellCalculations || {}),
      fields: {
        mEffectAmount: sp.mEffectAmount === undefined ? null : clone(sp.mEffectAmount),
        mCastTime: sp.mCastTime === undefined ? null : sp.mCastTime,
        spellCastTime: sp.spellCastTime === undefined ? null : sp.spellCastTime,
        spellTotalTime: sp.spellTotalTime === undefined ? null : sp.spellTotalTime,
        cooldownTime: sp.cooldownTime === undefined ? null : clone(sp.cooldownTime),
        mana: sp.mana === undefined ? null : clone(sp.mana),
        manaValues: sp.manaValues === undefined ? null : clone(sp.manaValues),
        mMaxAmmo: sp.mMaxAmmo === undefined ? null : clone(sp.mMaxAmmo),
        mAmmoRechargeTime: sp.mAmmoRechargeTime === undefined ? null : clone(sp.mAmmoRechargeTime),
        mTargetingTypeData: sp.mTargetingTypeData === undefined ? null : clone(sp.mTargetingTypeData),
      },
    },
    officialEvidence: { zh: clone(officialFor(heroId, slot, false)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot + "/currentTexts",
    officialMaxRank: meta.officialMaxRank,
  };
};

const P = key => ({ nodeType: "PARAMETER", parameterKey: key });
const A = (owner, key, kind) => ({ nodeType: "ATTRIBUTE", attributeOwner: owner, attributeKey: key, attributeValueKind: kind });
const O = (op, left, right) => ({ nodeType: "OPERATION", operation: op, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const AD = () => A("SOURCE", "attack_damage", "TOTAL");
const THP = () => A("TARGET", "hp", "TOTAL");
const fixed = (key, name, type, value, description, order) => ({ parameterKey: key, name, valueType: type, valueMode: "FIXED", fixedValue: value, levelValues: null, description, sortOrder: order });
const level = (key, name, type, values, description, order) => ({ parameterKey: key, name, valueType: type, valueMode: "SKILL_LEVEL", fixedValue: null, levelValues: values, description, sortOrder: order });
const character = (key, name, type, values, description, order) => ({ parameterKey: key, name, valueType: type, valueMode: "CHARACTER_LEVEL", fixedValue: null, levelValues: values, description, sortOrder: order });
const runtime = (key, name, type, description, order) => ({ parameterKey: key, name, valueType: type, valueMode: "RUNTIME_INPUT", fixedValue: null, levelValues: null, description, sortOrder: order });
const formula = (key, name, expression, description, order) => ({ formulaKey: key, name, expression, description, sortOrder: order });

const lifecycle = durationKey => ({
  durationValue: durationKey ? { kind: "PARAMETER", parameterKey: durationKey } : null,
  maxStacksValue: { kind: "FIXED", value: 1 }, applicationStacksValue: { kind: "FIXED", value: 1 },
  instanceScope: "SOURCE", reapplicationStackMode: "KEEP",
  reapplicationDurationMode: durationKey ? "REFRESH_ALL" : null,
  expiryMode: durationKey ? "ALL_AT_ONCE" : "EXPLICIT_ONLY",
  periodicIntervalValue: null, firstPeriodicExecution: null,
});
const resourceEffect = (resource, parameter, note) => ({
  effectKey: resource + "_cost", name: "施放" + (resource === "mana" ? "法力" : "能量") + "消耗",
  description: note + "仅记录基础资源消耗，实际扣除时点由事件层接线。",
  sortOrder: 900, lifecycle: null,
  results: [{
    resultKey: "consume_resource", name: "施放资源消耗", resultType: "RESOURCE_CHANGE", target: "SOURCE",
    description: "不表示战斗事件已经接线。", sortOrder: 10, lifecycleBehavior: null, spellShieldBlockScope: null,
    valueRule: { value: { kind: "PARAMETER", parameterKey: parameter }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { attributeKey: resource, operation: "CONSUME" },
  }],
});
const attrEffect = (key, name, description, value, attributeKey, zone, durationKey, order) => ({
  effectKey: key, name, description, sortOrder: order, lifecycle: lifecycle(durationKey),
  results: [{
    resultKey: "attribute", name, resultType: "ATTRIBUTE_CHANGE", target: "SOURCE",
    description: "只定义自身属性变化，触发条件由事件层接线。", sortOrder: 10,
    lifecycleBehavior: { moment: "PERSISTENT", valueReadMode: "APPLICATION_SNAPSHOT", stackValueMode: "SHARED", reapplicationValueMode: "REPLACE", periodicExecutionMode: null },
    spellShieldBlockScope: null,
    valueRule: { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { attributeKey, operation: "INCREASE", modifierZoneKey: zone },
  }],
});
const shieldEffect = (key, name, description, formulaKey, durationKey, order) => ({
  effectKey: key, name, description, sortOrder: order, lifecycle: lifecycle(durationKey),
  results: [{
    resultKey: "shield", name, resultType: "NORMAL_SHIELD", target: "SOURCE",
    description: "普通护盾，触发和移除事件由事件层接线。", sortOrder: 10,
    lifecycleBehavior: { moment: "PERSISTENT", valueReadMode: "APPLICATION_SNAPSHOT", stackValueMode: "SHARED", reapplicationValueMode: "REPLACE", periodicExecutionMode: null },
    spellShieldBlockScope: null,
    valueRule: { value: { kind: "FORMULA", formulaKey }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { absorbedDamageTypeKey: null, decayMode: "NONE" },
  }],
});

const defs = {};
const define = (heroId, slot, name, maxLevel, build, excluded, pending, proofNote) => {
  const skillKey = heroId.toLowerCase() + "_" + slot.toLowerCase();
  const w = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  const add = item => { if (!reuseSet.has(skillKey + "/" + item.parameterKey)) { assert(!w.parameters.some(x => x.parameterKey === item.parameterKey), "重复参数：" + skillKey + "/" + item.parameterKey); w.parameters.push(item); } };
  const addF = item => { assert(!w.formulas.some(x => x.formulaKey === item.formulaKey), "重复公式：" + skillKey + "/" + item.formulaKey); w.formulas.push(item); };
  build(add, addF, w);
  defs[skillKey] = {
    skillKey, name: heroes[heroId].name + "·" + name, maxLevel, source: sourceFor(heroId, slot), write: w,
    protectedExisting: { subject: Boolean(snapByRoute.get("/skills/" + skillKey)), compositionLists: true, protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json" },
    excluded, pending,
    proofs: [
      { type: "root-bound-source", path: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot },
      { type: "fixed-source-version", client: SOURCE_VERSION.clientVersion, official: SOURCE_VERSION.officialVersion, build: SOURCE_VERSION.build },
      { type: "cursor-source-review", runId: sourceReview.runId, verdict: sourceReview.verdict },
    ],
    proofNote, currentSubject: snapByRoute.get("/skills/" + skillKey)?.data || null,
  };
};
const spLevel = (h, s, d, max, k, n, t, desc, o, transform) => level(k, n, t, skillValues(h, s, d, max, transform), desc, o);
const spFixed = (h, s, d, k, n, t, desc, o, index, transform) => fixed(k, n, t, sourceFixed(h, s, d, index, transform), desc, o);
const coeff = (h, s, c, i, k, n, desc, o) => {
  const part = rawPart(h, s, c, i);
  assert(typeof part.mCoefficient === "number", "缺少树系数：" + h + "/" + s + "/" + c);
  return fixed(k, n, "DECIMAL", norm(part.mCoefficient), desc, o);
};
const fixedTime = (h, s, field) => fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", time(h, s, field), "当前根字段时间转为毫秒；不表示命中时点。", 999);

const breakpoint = part => {
  assert(typeof part.mLevel1Value === "number", "断点树缺少起点");
  let value = part.mLevel1Value;
  const points = (part.mBreakpoints || []).slice().sort((a, b) => a.mLevel - b.mLevel);
  const out = {};
  for (let l = 1; l <= 18; l++) {
    if (l > 1) {
      const slope = points.slice().reverse().find(point => point.mLevel <= l - 1 && typeof point.mBonusPerLevelAtAndAfter === "number");
      value += slope ? slope.mBonusPerLevelAtAndAfter : (part.mInitialBonusPerLevel || 0);
      for (const point of points.filter(point => point.mLevel === l)) value += point.mAdditionalBonusAtThisLevel || 0;
    }
    out[String(l)] = norm(value);
  }
  return out;
};

define("Bard", "P", "旅者的召唤", 1, (add, addF) => {
  add(spFixed("Bard", "P", "TooltipMSPerStack", "tooltip_ms_per_stack_percent", "每层非战斗移动速度（百分数点）", "INTEGER", "当前正文直接显示24%。", 10, 1));
  add(spFixed("Bard", "P", "TooltipMSMax", "tooltip_ms_max_percent", "非战斗移动速度上限（百分数点）", "INTEGER", "当前正文直接显示150%。", 20, 1));
  add(spFixed("Bard", "P", "TooltipManaRestore", "tooltip_mana_restore_percent", "最大法力回复（百分数点）", "INTEGER", "当前正文直接显示12%；经验奖励排除。", 30, 1));
  add(spFixed("Bard", "P", "BaseMeepDamage", "meep_base_damage", "木灵基础魔法伤害", "INTEGER", "当前树取索引0的30。", 40, 0));
  add(spFixed("Bard", "P", "TooltipChimeDamageCheckpoint", "chime_damage_checkpoint", "木灵伤害层数间隔", "INTEGER", "当前正文每5层增加一次。", 50, 1));
  add(spFixed("Bard", "P", "DamagePerCheckpoint", "damage_per_checkpoint", "每个层数间隔伤害增加", "INTEGER", "当前正文直接消费6。", 60, 1));
  add(spFixed("Bard", "P", "SlowDuration", "slow_duration_ms", "木灵减速持续（毫秒）", "INTEGER", "1秒转毫秒；f2幅度未展开。", 70, 1, toMs));
  add(spFixed("Bard", "P", "ChimesPerUpgrade", "chimes_per_upgrade", "升级所需调和之音层数", "INTEGER", "技能数组有效索引1为5，索引0的0不作门槛。", 80, 1));
  add(spFixed("Bard", "P", "MeepAPRatio", "meep_ap_ratio", "木灵法强倍率", "DECIMAL", "当前树第二项按来源总法强。", 90, 1));
  add(spFixed("Bard", "P", "MaxSpeedStacks", "max_speed_stacks", "非战斗移速最大层数", "INTEGER", "当前正文直接消费10。", 100, 1));
  add(spFixed("Bard", "P", "SpeedStackDuration", "speed_stack_duration_ms", "非战斗移速持续（毫秒）", "INTEGER", "20秒转毫秒。", 110, 1, toMs));
  add(fixed("chimes_slow_multiplier", "减速升级树乘数", "INTEGER", 1, "当前树NumberCalculationPart=1。", 120));
  add(fixed("chimes_splash_damage_multiplier", "范围伤害升级树乘数", "INTEGER", 3, "当前树NumberCalculationPart=3。", 130));
  add(fixed("chimes_splash_area_multiplier", "范围扩大升级树乘数", "INTEGER", 7, "当前树NumberCalculationPart=7。", 140));
  addF(formula("meep_damage_no_chime", "无调和之音木灵伤害", ADD(P("meep_base_damage"), MUL(P("meep_ap_ratio"), AP())), "对应MeepDamageNoChime。", 10));
  addF(formula("chimes_for_slow_upgrade", "减速升级所需调和之音", MUL(P("chimes_per_upgrade"), P("chimes_slow_multiplier")), "对应ChimesForSlowUpgrade。", 20));
  addF(formula("chimes_for_splash_damage_upgrade", "范围伤害升级所需调和之音", MUL(P("chimes_per_upgrade"), P("chimes_splash_damage_multiplier")), "对应ChimesForSplashDamageUpgrade。", 30));
  addF(formula("chimes_for_splash_area_upgrade", "范围扩大升级所需调和之音", MUL(P("chimes_per_upgrade"), P("chimes_splash_area_multiplier")), "对应ChimesForSplashAreaUpgrade。", 40));
}, [
  { item: "经验奖励", reason: "本批范围排除经验金币效果。" },
  { item: "额外敌人溅射及范围结果", reason: "唯一敌方一对一不建立额外目标结果。" },
], [
  { item: "f1/f4/f5、木灵数量和生成周期", reason: "当前正文消费但完整数值树未展开；BaseMeepSpawnCD=8不宣告为固定成长周期。" },
  { item: "f2减速幅度", reason: "来源未展开，不能补零。" },
], "保留木灵当前附加伤害、调和层数阈值、法力回复和非战斗移速；经验排除。");

define("Bard", "Q", "星界束缚", 5, (add, addF, w) => {
  add(spLevel("Bard", "Q", "BaseDamage", 5, "base_damage", "基础魔法伤害", "INTEGER", "技能等级取DataValues索引1至5。", 10));
  add(spFixed("Bard", "Q", "APRatio", "ap_ratio", "法强倍率", "DECIMAL", "TotalDamage树第二项按来源总法强。", 20, 1));
  add(spFixed("Bard", "Q", "SlowAmountPercentage", "slow_percent", "减速百分数点", "INTEGER", "当前正文显示60%。", 30, 1));
  add(spLevel("Bard", "Q", "SlowDuration", 5, "slow_duration_ms", "减速持续（毫秒）", "INTEGER", "等级索引1至5，秒转毫秒。", 40, toMs));
  add(spLevel("Bard", "Q", "StunDuration", 5, "stun_duration_ms", "晕眩持续（毫秒）", "INTEGER", "等级索引1至5，秒转毫秒。", 50, toMs));
  add(fixedTime("Bard", "Q", "mCastTime"));
  addF(formula("total_damage", "星界束缚魔法伤害", ADD(P("base_damage"), MUL(P("ap_ratio"), AP())), "对应TotalDamage。", 10));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "第二敌人独立结果", reason: "只保留首敌数值及墙体条件。" }], [{ item: "墙体/第二目标命中时序", reason: "事件待接。" }], "保留首敌伤害、减速和撞墙晕眩。");

define("Bard", "W", "游神圣坛", 5, (add, addF, w) => {
  add(spFixed("Bard", "W", "ChargeupTime", "chargeup_time_ms", "充能时间（毫秒）", "INTEGER", "5秒转毫秒。", 10, 1, toMs));
  add(spFixed("Bard", "W", "MaxPacks", "max_packs", "同时存在数量上限", "INTEGER", "正文上限3座。", 20, 1));
  add(spFixed("Bard", "W", "HealingMult", "healing_multiplier", "治疗倍率", "DECIMAL", "InitialHeal/MaxHeal共同使用1。", 30, 1));
  add(spFixed("Bard", "W", "Ammo_Limit", "ammo_limit", "充能层数", "INTEGER", "正文显示2层。", 40, 1));
  add(spFixed("Bard", "W", "Ammo_Cooldown", "ammo_recharge_ms", "充能回复时间（毫秒）", "INTEGER", "18秒转毫秒。", 50, 1, toMs));
  add(spFixed("Bard", "W", "MoveSpeed_Duration", "move_speed_duration_ms", "移速持续（毫秒）", "INTEGER", "1.5秒转毫秒。", 60, 1, toMs));
  add(spLevel("Bard", "W", "MoveSpeed_Base", 5, "move_speed_base_ratio", "移速基础比例", "DECIMAL", "等级索引1至5。", 70));
  add(spFixed("Bard", "W", "MoveSpeed_Ratio", "move_speed_ap_ratio", "移速法强倍率", "DECIMAL", "Calc_MoveSpeed第二项。", 80, 1));
  add(spLevel("Bard", "W", "MinimumHeal", 5, "minimum_heal", "最低治疗基础值", "DECIMAL", "等级索引1至5。", 90));
  add(spLevel("Bard", "W", "MaximumHeal", 5, "maximum_heal", "满额治疗基础值", "DECIMAL", "等级索引1至5。", 100));
  add(spFixed("Bard", "W", "APRatio_Min", "minimum_heal_ap_ratio", "最低治疗法强倍率", "DECIMAL", "InitialHeal第二项。", 110, 1));
  add(spFixed("Bard", "W", "APRatio_Max", "maximum_heal_ap_ratio", "满额治疗法强倍率", "DECIMAL", "MaxHeal第二项。", 120, 1));
  add(fixedTime("Bard", "W", "spellCastTime"));
  addF(formula("initial_heal", "圣坛最低治疗量", MUL(P("healing_multiplier"), ADD(P("minimum_heal"), MUL(P("minimum_heal_ap_ratio"), AP()))), "对应InitialHeal。", 10));
  addF(formula("maximum_heal", "圣坛满额治疗量", MUL(P("healing_multiplier"), ADD(P("maximum_heal"), MUL(P("maximum_heal_ap_ratio"), AP()))), "对应MaxHeal。", 20));
  addF(formula("move_speed", "圣坛移动速度加成", ADD(P("move_speed_base_ratio"), MUL(P("move_speed_ap_ratio"), AP())), "对应Calc_MoveSpeed，输出比例。", 30));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "敌人踩毁圣坛", reason: "额外区域事件不建结果。" }], [{ item: "充能中间曲线与当前圣坛状态f1/f2", reason: "仅保留端点和无默认待接输入。" }], "保留自身可踩圣坛治疗和移速；中间充能曲线待补。");

define("Bard", "E", "神奇旅程", 5, (add, addF, w) => {
  add(level("cooldown_ms", "基础冷却时间（毫秒）", "INTEGER", { "1": 22000, "2": 20500, "3": 19000, "4": 17500, "5": 16000 }, "当前根技能等级冷却，单位毫秒；本项不在公共复用清单。", 10));
  add(level("mana_cost", "基础法力消耗", "INTEGER", { "1": 30, "2": 30, "3": 30, "4": 30, "5": 30 }, "当前根技能等级法力；本项不在公共复用清单。", 20));
  add(spLevel("Bard", "E", "DoorDuration", 5, "door_duration_ms", "传送门持续（毫秒）", "INTEGER", "10秒转毫秒。", 30, toMs));
  add(spLevel("Bard", "E", "FriendlyMovementBonusPercentage", 5, "friendly_move_speed_bonus_percent", "友军传送速度加成（百分数点）", "INTEGER", "当前正文33%。", 40));
  add(spLevel("Bard", "E", "BaseTravelSpeed", 5, "base_travel_speed", "基础传送速度", "INTEGER", "保存原始速度，不作普通移动速度属性。", 50));
  add(fixedTime("Bard", "E", "mCastTime"));
  w.effects.push(resourceEffect("mana", "mana_cost", "本技能使用候选新增法力参数；"));
}, [{ item: "路线几何与传送结果", reason: "只留当前文本数值。" }], [{ item: "友军含自身资格与传送时序", reason: "资格保留，事件待接。" }], "保留传送门持续、友军速度差和基础速度。");

define("Bard", "R", "调和命运", 3, (add, addF, w) => {
  add(spLevel("Bard", "R", "RStasisDuration", 3, "stasis_duration_ms", "凝滞持续（毫秒）", "INTEGER", "2.5秒转毫秒。", 10, toMs));
  add(fixedTime("Bard", "R", "mCastTime"));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "建筑、小兵、野怪结果", reason: "唯一敌方英雄范围排除。" }], [{ item: "凝滞限制、防护与行为时序", reason: "只保留持续时间。" }], "只保存凝滞时长。");

define("Milio", "P", "热情洋溢！", 1, (add, addF) => {
  add(character("ad_burst_ratio", "附加攻击力比例", "DECIMAL", breakpoint(rawPart("Milio", "P", "ADBurstRatio")), "1至5级7%，6级起加4个百分点，9级起再加4个百分点；保留明确断点。", 10));
  add(runtime("burn_base_damage_at_character_level", "灼烧角色等级基础伤害（实际值外供）", "DECIMAL", "BurnDamage的匿名等级插值端点为10至50，中间曲线未知，实际值无默认。", 20));
  add(coeff("Milio", "P", "BurnDamage", 1, "burn_ap_ratio", "灼烧法强倍率", "当前BurnDamage系数0.2，按来源总法强。", 30));
  add(spFixed("Milio", "P", "BurnDuration", "burn_duration_ms", "灼烧持续（毫秒）", "INTEGER", "1.5秒转毫秒。", 40, 1, toMs));
  addF(formula("ad_burst_damage", "附加攻击力伤害", MUL(P("ad_burst_ratio"), AD()), "角色等级比例×被附加英雄来源总攻击力。", 10));
  addF(formula("burn_damage", "灼烧魔法伤害", ADD(P("burn_base_damage_at_character_level"), MUL(P("burn_ap_ratio"), AP())), "匿名等级基础实际输入+0.2×来源总法强。", 20));
}, [{ item: "野怪100点上限", reason: "兵野专用排除。" }], [{ item: "技能触碰、下一次伤害和灼烧事件", reason: "自身资格有补证，触发待接。" }, { item: "灼烧中间曲线", reason: "实际输入无默认。" }], "保留自身附加攻击力伤害和一次灼烧；断点与未知灼烧曲线分开。");

define("Milio", "Q", "火爆飞踢", 5, (add, addF, w) => {
  add(level("cooldown_ms", "基础冷却时间（毫秒）", "INTEGER", { "1": 10000, "2": 10000, "3": 10000, "4": 10000, "5": 10000 }, "官方16.17.1冷却10秒；客户端未提供cooldownTime，转毫秒。", 10));
  add(spLevel("Milio", "Q", "FallDamage", 5, "damage_base", "落地基础魔法伤害", "INTEGER", "Damage第一项，等级索引1至5。", 20));
  add(coeff("Milio", "Q", "Damage", 1, "damage_ap_ratio", "伤害法强倍率", "当前系数1.2。", 30));
  add(spLevel("Milio", "Q", "SlowAmount", 5, "slow_base_ratio", "减速基础比例", "DECIMAL", "等级索引1至5，保存0.40至0.60比例。", 40));
  add(coeff("Milio", "Q", "SlowAmountPercent", 1, "slow_ap_ratio", "减速法强倍率", "当前系数0.0005，输出比例。", 50));
  add(spFixed("Milio", "Q", "SlowDuration", "slow_duration_ms", "减速持续（毫秒）", "INTEGER", "1.5秒转毫秒。", 60, 1, toMs));
  add(spFixed("Milio", "Q", "KnockbackDistance", "knockback_distance", "英雄击退距离", "INTEGER", "英雄击退140。", 70, 1));
  add(spFixed("Milio", "Q", "FallTime", "fall_time_ms", "落地时间（毫秒）", "INTEGER", "0.8秒转毫秒。", 80, 1, toMs));
  add(spFixed("Milio", "Q", "FallRadius", "fall_radius", "落地范围", "INTEGER", "英雄范围250。", 90, 1));
  add(spFixed("Milio", "Q", "ImpactAdjustment", "impact_adjustment", "落点调整距离", "INTEGER", "当前值50。", 100, 1));
  add(spFixed("Milio", "Q", "RefundRatio", "refund_ratio", "命中英雄返还法力比例", "DECIMAL", "当前正文50%。", 110, 1));
  addF(formula("damage", "火爆飞踢魔法伤害", ADD(P("damage_base"), MUL(P("damage_ap_ratio"), AP())), "对应Damage。", 10));
  addF(formula("slow_amount", "火爆飞踢减速比例", ADD(P("slow_base_ratio"), MUL(P("slow_ap_ratio"), AP())), "对应SlowAmountPercent。", 20));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "小兵野怪击退、范围和视野", reason: "兵野专用排除。" }], [{ item: "mCastTime与spellCastTime冲突", reason: "0.25与0并存，不任选。" }], "保留首个英雄伤害、减速、击退和返还比例。");

define("Milio", "W", "依依不舍", 5, (add, addF, w) => {
  add(spFixed("Milio", "W", "ZoneDuration", "zone_duration_ms", "炉火持续（毫秒）", "INTEGER", "6秒转毫秒。", 10, 1, toMs));
  add(spFixed("Milio", "W", "Radius", "zone_radius", "炉火范围", "INTEGER", "当前值350。", 20, 1));
  add(spLevel("Milio", "W", "RangePctIncrease", 5, "range_increase_ratio", "攻击距离提升比例", "DECIMAL", "RangePercent取等级索引1至5。", 30));
  add(spFixed("Milio", "W", "HealFrequencySeconds", "passive_interval_ms", "施加被动间隔（毫秒）", "INTEGER", "3秒转毫秒，不当作治疗跳数。", 40, 1, toMs));
  add(spLevel("Milio", "W", "TotalHealingOverTime", 5, "total_heal_base", "总治疗基础值", "INTEGER", "HealingOverTime取等级索引1至5。", 50));
  add(spFixed("Milio", "W", "HealAPRatio", "heal_ap_ratio", "治疗法强倍率", "DECIMAL", "当前系数0.15。", 60, 1));
  addF(formula("range_percent", "攻击距离提升", P("range_increase_ratio"), "对应RangePercent，输出比例。", 10));
  addF(formula("healing_over_time", "总治疗量", ADD(P("total_heal_base"), MUL(P("heal_ap_ratio"), AP())), "对应HealingOverTime，总量不拆成逐跳直接结果。", 20));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
  w.effects.push(attrEffect("self_attack_range", "炉火自身攻击距离提升", "自身可作为附近友方受益者；最近友方选择待接。", { kind: "FORMULA", formulaKey: "range_percent" }, "attack_range", "attribute_percent_bonus", "zone_duration_ms", 30));
}, [{ item: "第三友方独立治疗", reason: "只保留自身公式。" }], [{ item: "区域跟随、治疗和每3秒施加事件", reason: "数值保留，时序待接。" }], "保留自身攻击距离和治疗数值，不创建区域自主单位。");

define("Milio", "E", "融融情谊", 5, (add, addF, w) => {
  add(spLevel("Milio", "E", "MoveSpeedAmount", 5, "move_speed_ratio", "移动速度提升比例", "DECIMAL", "取等级索引1至5。", 10));
  add(spFixed("Milio", "E", "MoveSpeedDuration", "move_speed_duration_ms", "移动速度持续（毫秒）", "INTEGER", "2.5秒转毫秒。", 20, 1, toMs));
  add(spLevel("Milio", "E", "ShieldBase", 5, "shield_base", "护盾基础值", "INTEGER", "ShieldCalc第一项取等级索引1至5。", 30));
  add(coeff("Milio", "E", "ShieldCalc", 1, "shield_ap_ratio", "护盾法强倍率", "当前系数0.45。", 40));
  add(fixed("max_ammo", "护盾充能层数", "INTEGER", 2, "当前mMaxAmmo有效技能等级值均为2。", 50));
  add(level("ammo_recharge_ms", "护盾充能回复时间（毫秒）", "INTEGER", { "1": 17000, "2": 16000, "3": 15000, "4": 14000, "5": 13000 }, "当前mAmmoRechargeTime索引1至5，17/16/15/14/13秒转毫秒。", 60));
  add(level("cooldown_ms", "独立施放间隔（毫秒）", "INTEGER", { "1": 500, "2": 500, "3": 500, "4": 500, "5": 500 }, "当前cooldownTime=0.5秒，区别于充能回复。", 70));
  addF(formula("shield_value", "融融情谊护盾值", ADD(P("shield_base"), MUL(P("shield_ap_ratio"), AP())), "对应ShieldCalc。", 10));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
  w.effects.push(shieldEffect("self_shield", "融融情谊自身普通护盾", "补证支持自身护盾；叠加事件待接。", "shield_value", null, 20));
  w.effects.push(attrEffect("self_move_speed", "融融情谊自身移动速度提升", "补证支持自身目标；持续时间来自正文。", { kind: "PARAMETER", parameterKey: "move_speed_ratio" }, "move_speed_percent", "attribute_percent_bonus", "move_speed_duration_ms", 30));
}, [{ item: "第三友方护盾", reason: "不建立其他友方对象结果。" }], [{ item: "两层护盾实例和施法时间冲突", reason: "自身收益保留，叠加规则和0.01/0.175冲突待接。" }], "保留自身普通护盾和移动速度。");

define("Milio", "R", "生生不息", 3, (add, addF, w) => {
  add(spLevel("Milio", "R", "HealBase", 3, "heal_base", "治疗基础值", "INTEGER", "HealCalc取等级索引1至3。", 10));
  add(coeff("Milio", "R", "HealCalc", 1, "heal_ap_ratio", "治疗法强倍率", "当前系数0.5。", 20));
  add(spFixed("Milio", "R", "TenacityDuration", "tenacity_duration_ms", "韧性持续（毫秒）", "INTEGER", "3秒转毫秒。", 30, 1, toMs));
  add(spFixed("Milio", "R", "TenacityAmount", "tenacity_ratio", "韧性比例", "DECIMAL", "当前65%。", 40, 1));
  add(fixedTime("Milio", "R", "mCastTime"));
  addF(formula("heal_value", "生生不息治疗量", ADD(P("heal_base"), MUL(P("heal_ap_ratio"), AP())), "对应HealCalc；不创建直接治疗结果。", 10));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "击飞净化和第三友方独立结果", reason: "正文明确不净化击飞；第三友方结果不建。" }], [{ item: "自身区域资格与禁止施法时机、HealFXDelay", reason: "SelfAoe与NeverSelf并存，特效延迟不是治疗时点。" }], "保留治疗与韧性数值，不把SelfAoe字段直接解释为自身效果。");

define("Rakan", "P", "异色羽裳", 1, (add, addF, w) => {
  add(runtime("shield_base_at_character_level", "护盾角色等级基础值（实际值外供）", "DECIMAL", "TotalShield第一项为30至225角色等级插值，算法未证；实际值无默认。", 10));
  add(coeff("Rakan", "P", "TotalShield", 1, "shield_ap_ratio", "护盾法强倍率", "当前系数0.95。", 20));
  add(runtime("shield_cooldown_at_character_level", "护盾角色等级冷却（实际值外供）", "DECIMAL", "ShieldCooldown树40起点、初始每级-1.5、19级后-0.875；算法未证。", 30));
  add(spFixed("Rakan", "P", "HitCooldown", "hit_cooldown_seconds", "命中英雄缩短冷却（秒）", "DECIMAL", "当前正文直接消费1秒。", 40, 1));
  addF(formula("total_shield", "异色羽裳护盾值", ADD(P("shield_base_at_character_level"), MUL(P("shield_ap_ratio"), AP())), "对应TotalShield，基础值由角色等级实际输入提供。", 10));
  addF(formula("shield_cooldown", "异色羽裳护盾冷却", P("shield_cooldown_at_character_level"), "对应ShieldCooldown的实际角色等级值。", 20));
  w.effects.push(shieldEffect("self_shield", "异色羽裳自身普通护盾", "当前正文明确自身周期性护盾。", "total_shield", null, 30));
}, [{ item: "霞合体回城", reason: "双英雄关系效果排除。" }], [{ item: "护盾和冷却角色等级中间曲线", reason: "实际输入无默认。" }], "保留自身护盾和命中减冷却。");

define("Rakan", "Q", "微光飞翎", 5, (add, addF, w) => {
  add(spLevel("Rakan", "Q", "BaseDamage", 5, "damage_base", "基础魔法伤害", "INTEGER", "等级索引1至5。", 10));
  add(spFixed("Rakan", "Q", "DamageAPRatio", "damage_ap_ratio", "伤害法强倍率", "DECIMAL", "当前系数0.7。", 20, 1));
  add(spFixed("Rakan", "Q", "HealDelay", "heal_delay_ms", "命中后治疗延迟（毫秒）", "INTEGER", "3秒转毫秒。", 30, 1, toMs));
  add(runtime("self_heal_base_at_character_level", "自身治疗角色等级基础值（实际值外供）", "DECIMAL", "TotalHeal第一项为40至210插值，实际值无默认。", 40));
  add(spFixed("Rakan", "Q", "HealAPRatio", "heal_ap_ratio", "自身治疗法强倍率", "DECIMAL", "当前系数0.55。", 50, 1));
  addF(formula("total_damage", "微光飞翎魔法伤害", ADD(P("damage_base"), MUL(P("damage_ap_ratio"), AP())), "对应TotalDamage。", 10));
  addF(formula("total_heal", "微光飞翎自身治疗量", ADD(P("self_heal_base_at_character_level"), MUL(P("heal_ap_ratio"), AP())), "对应TotalHeal，保留自己自然到时分支。", 20));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "附近其他友方和史诗野怪结果", reason: "只保留自身治疗及唯一敌人伤害。" }], [{ item: "自身治疗曲线、3秒/触碰触发和匿名冷却树", reason: "运行输入和事件待接；公共冷却不覆盖。" }], "保留单敌伤害与自身治疗量。");

define("Rakan", "W", "盛大登场", 5, (add, addF, w) => {
  add(spLevel("Rakan", "W", "BaseDamage", 5, "damage_base", "基础魔法伤害", "INTEGER", "等级索引1至5，避免mEffectAmount索引0占位。", 10));
  add(coeff("Rakan", "W", "TotalDamage", 1, "damage_ap_ratio", "伤害法强倍率", "当前系数0.8。", 20));
  add(spLevel("Rakan", "W", "KnockupDuration", 5, "knockup_duration_ms", "击飞持续（毫秒）", "INTEGER", "1秒转毫秒。", 30, toMs));
  add(spFixed("Rakan", "W", "BaseDashSpeed", "base_dash_speed", "基础冲刺速度", "INTEGER", "保存原始速度。", 40, 1));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Rakan", "W").spellCastTime), "当前spellCastTime=0；不表示命中时序。", 50));
  addF(formula("total_damage", "盛大登场魔法伤害", ADD(P("damage_base"), MUL(P("damage_ap_ratio"), AP())), "对应TotalDamage。", 10));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "额外敌人", reason: "唯一敌人范围只保留当前目标。" }], [{ item: "冲刺命中时序", reason: "基础速度保留，事件待接。" }], "保留自身冲刺、唯一敌方伤害和击飞。");

define("Rakan", "E", "轻舞成双", 5, (add, addF, w) => {
}, [{ item: "友方位移护盾与霞联动", reason: "第三友方和双英雄关系效果排除；空组成受保护。" }], [{ item: "自身施放资格", reason: "当前正文限定友方英雄，没有自身窄证。" }], "本轮不新增洛E组成。");

define("Rakan", "R", "惊鸿过隙", 3, (add, addF, w) => {
  add(spLevel("Rakan", "R", "BaseDamage", 3, "damage_base", "触碰基础魔法伤害", "INTEGER", "等级索引1至3。", 10));
  add(coeff("Rakan", "R", "TotalDamageTooltip", 1, "damage_ap_ratio", "伤害法强倍率", "当前系数0.5。", 20));
  add(spFixed("Rakan", "R", "Duration", "self_speed_duration_ms", "自身移速持续（毫秒）", "INTEGER", "4秒转毫秒。", 30, 1, toMs));
  add(spFixed("Rakan", "R", "InitialCastSpeed", "initial_move_speed_percent", "初始移速加成（百分数点）", "INTEGER", "当前正文75%。", 40, 1));
  add(spLevel("Rakan", "R", "CharmDuration", 3, "charm_duration_ms", "魅惑持续（毫秒）", "INTEGER", "等级索引1至3，秒转毫秒。", 50, toMs));
  add(spFixed("Rakan", "R", "TouchSpeed", "touch_move_speed_percent", "首次触敌移速加成（百分数点）", "INTEGER", "当前正文150%，衰减函数待接。", 60, 1));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Rakan", "R").spellCastTime), "当前spellCastTime=0.25秒。", 70));
  addF(formula("total_damage", "惊鸿过隙魔法伤害", ADD(P("damage_base"), MUL(P("damage_ap_ratio"), AP())), "对应TotalDamageTooltip。", 10));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
  w.effects.push(attrEffect("self_initial_move_speed", "惊鸿过隙自身初始移动速度", "正文明确自身4秒75%移速。", { kind: "PARAMETER", parameterKey: "initial_move_speed_percent" }, "move_speed_percent", "attribute_percent_bonus", "self_speed_duration_ms", 20));
  w.effects.push(attrEffect("self_touch_move_speed", "惊鸿过隙首次触敌自身移动速度", "正文明确首次敌方英雄触碰后的自身衰减移速。", { kind: "PARAMETER", parameterKey: "touch_move_speed_percent" }, "move_speed_percent", "attribute_percent_bonus", null, 30));
}, [{ item: "第二敌方英雄", reason: "不建立第二目标。" }], [{ item: "触敌移速衰减函数和BuffExtensionDuration/TouchRadius", reason: "衰减或未消费字段不猜。" }], "保留自身移速、唯一敌人伤害和首次魅惑。");

define("Renata", "P", "物尽其用", 1, (add, addF) => {
  add(runtime("self_amp_base_at_character_level", "自身标记伤害角色等级基础比例（实际值外供）", "DECIMAL", "原树1级0.01、6/9级断点，但完整求值算法未证；实际输入无默认。", 10));
  add(spFixed("Renata", "P", "APToPercentRatio", "ap_to_percent_ratio", "法强比例", "DECIMAL", "当前自身树系数0.0002。", 20, 1));
  add(spFixed("Renata", "P", "PassiveDuration", "mark_duration_ms", "标记持续（毫秒）", "INTEGER", "6秒转毫秒。", 30, 1, toMs));
  add(fixed("max_marked_targets", "同时标记目标上限", "INTEGER", 1, "正文明确同时只能一个目标。", 40));
  addF(formula("self_percent_amp", "自身标记伤害比例", ADD(P("self_amp_base_at_character_level"), MUL(P("ap_to_percent_ratio"), AP())), "对应PercentAmpCalcSelf。", 10));
  addF(formula("self_mark_damage", "自身标记目标生命值伤害", MUL(ADD(P("self_amp_base_at_character_level"), MUL(P("ap_to_percent_ratio"), AP())), THP()), "当前正文比例乘目标最大生命值。", 20));
}, [{ item: "队友消费标记与野怪150上限", reason: "纯第三友方和兵野支路排除。" }], [{ item: "角色等级断点完整曲线与攻击/标记事件", reason: "保留实际输入和6秒标记，事件待接。" }], "保留自身攻击对唯一敌人的未标记附加伤害并乘目标总生命。");

define("Renata", "Q", "铁腕竞合", 5, (add, addF, w) => {
  add(spLevel("Renata", "Q", "Damage", 5, "damage_base", "基础魔法伤害", "INTEGER", "等级索引1至5。", 10));
  add(spFixed("Renata", "Q", "APRatio", "damage_ap_ratio", "伤害法强倍率", "DECIMAL", "当前系数0.8。", 20, 1));
  add(spFixed("Renata", "Q", "RootDuration", "root_duration_ms", "禁锢持续（毫秒）", "INTEGER", "1秒转毫秒。", 30, 1, toMs));
  add(spFixed("Renata", "Q", "PullDistance", "pull_distance", "拉拽距离", "INTEGER", "当前值275。", 40, 1));
  add(spFixed("Renata", "Q", "StunDuration", "stun_duration_ms", "被拉英雄晕眩持续（毫秒）", "INTEGER", "0.5秒转毫秒，条件为被拉目标是英雄。", 50, 1, toMs));
  add(spFixed("Renata", "Q", "SelfSlow", "self_slow_ratio", "自身减速比例（来源待核）", "DECIMAL", "保留-0.3原值，不猜单位和时序。", 60, 1));
  addF(formula("total_damage", "铁腕竞合魔法伤害", ADD(P("damage_base"), MUL(P("damage_ap_ratio"), AP())), "对应TotalDamage，首段/再施放同一当前敌人可复用。", 10));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "被抛向第二敌人分支", reason: "本批不编造第二目标。" }], [{ item: "SelfSlow作用与施法字段冲突", reason: "原值保留，0.25与0不任选。" }], "保留唯一敌人首段和再施放伤害、禁锢、拉拽和被拉英雄晕眩。");

define("Renata", "W", "及时救难", 5, (add, addF, w) => {
  add(spLevel("Renata", "W", "Duration", 5, "duration_ms", "增益持续（毫秒）", "INTEGER", "5秒转毫秒。", 10, toMs));
  add(spLevel("Renata", "W", "BonusAttackSpeed", 5, "bonus_attack_speed_points", "初始攻击速度百分数点", "DECIMAL", "等级索引1至5；外层0.01转比例。", 20));
  add(spLevel("Renata", "W", "BonusMoveSpeed", 5, "bonus_move_speed_points", "朝敌移动速度百分数点", "DECIMAL", "等级索引1至5；外层0.01转比例。", 30));
  add(spFixed("Renata", "W", "APToPercentRatio", "ap_to_percent_ratio", "法强转百分数点比例", "DECIMAL", "原值0.01。", 40, 1));
  add(fixed("stat_output_scale", "初始属性输出缩放", "DECIMAL", 0.01, "对应AS/MS树NumberCalculationPart。", 50));
  add(fixed("final_stat_output_scale", "满额属性输出缩放", "DECIMAL", 0.02, "对应FinalAS/MS树，初始值两倍。", 60));
  add(spFixed("Renata", "W", "TriumphPercent", "triumph_percent", "参与击杀回复最大生命百分数点", "INTEGER", "正文直接显示20%。", 70, 1));
  add(spFixed("Renata", "W", "MaxStatMultiplier", "max_stat_multiplier", "满额属性倍率", "DECIMAL", "来源显示2倍，与0.02缩放对应。", 80, 1));
  add(fixed("death_decay_duration_ms", "复活后生命衰减持续（毫秒）", "INTEGER", 3000, "当前中文/英文正文明确3秒；不采用匿名2.5秒。", 90));
  addF(formula("initial_attack_speed", "初始攻击速度", MUL(P("stat_output_scale"), ADD(P("bonus_attack_speed_points"), MUL(P("ap_to_percent_ratio"), AP()))), "对应ASCalc。", 10));
  addF(formula("initial_move_speed", "初始移动速度", MUL(P("stat_output_scale"), ADD(P("bonus_move_speed_points"), MUL(P("ap_to_percent_ratio"), AP()))), "对应MSCalc。", 20));
  addF(formula("final_attack_speed", "满额攻击速度", MUL(P("final_stat_output_scale"), ADD(P("bonus_attack_speed_points"), MUL(P("ap_to_percent_ratio"), AP()))), "对应FinalASCalc。", 30));
  addF(formula("final_move_speed", "满额移动速度", MUL(P("final_stat_output_scale"), ADD(P("bonus_move_speed_points"), MUL(P("ap_to_percent_ratio"), AP()))), "对应FinalMSCalc。", 40));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
  w.effects.push(attrEffect("self_attack_speed", "及时救难自身攻击速度", "补证支持自身可被选中；中间提升待接。", { kind: "FORMULA", formulaKey: "initial_attack_speed" }, "bonus_attack_speed_percent", "attribute_percent_bonus", "duration_ms", 100));
  w.effects.push(attrEffect("self_move_speed", "及时救难自身移动速度", "补证支持自身可被选中；朝敌方向。", { kind: "FORMULA", formulaKey: "initial_move_speed" }, "move_speed_percent", "attribute_percent_bonus", "duration_ms", 110));
}, [{ item: "第三友方复活结果", reason: "只保留自身可选方向及数值。" }], [{ item: "自身资格、致死和衰减事件", reason: "资格与正文保留，事件层待接；中间曲线未知。" }], "保留自身攻速、移速、满额两倍和正文3秒复活衰减。");

define("Renata", "E", "忠诚激励", 5, (add, addF, w) => {
  add(spLevel("Renata", "E", "Damage", 5, "damage_base", "单敌基础魔法伤害", "INTEGER", "等级索引1至5。", 10));
  add(coeff("Renata", "E", "TotalDamage", 1, "damage_ap_ratio", "伤害法强倍率", "当前系数0.55。", 20));
  add(spFixed("Renata", "E", "SlowPercent", "slow_percent", "减速百分数点", "INTEGER", "正文直接显示30%。", 30, 1));
  add(spFixed("Renata", "E", "SlowDuration", "slow_duration_ms", "减速持续（毫秒）", "INTEGER", "2秒转毫秒。", 40, 1, toMs));
  add(spLevel("Renata", "E", "ShieldValue", 5, "shield_base", "护盾基础值", "INTEGER", "等级索引1至5。", 50));
  add(spFixed("Renata", "E", "ShieldAPRatio", "shield_ap_ratio", "护盾法强倍率", "DECIMAL", "当前系数0.5。", 60, 1));
  add(spFixed("Renata", "E", "ShieldDuration", "shield_duration_ms", "护盾持续（毫秒）", "INTEGER", "3秒转毫秒。", 70, 1, toMs));
  add(spFixed("Renata", "E", "InitialAoE", "initial_aoe", "初始范围", "INTEGER", "当前值325，额外敌人结果排除。", 80, 1));
  add(spFixed("Renata", "E", "EndAoE", "end_aoe", "终点范围", "INTEGER", "当前值225，额外敌人结果排除。", 90, 1));
  addF(formula("total_damage", "忠诚激励单敌魔法伤害", ADD(P("damage_base"), MUL(P("damage_ap_ratio"), AP())), "对应TotalDamage。", 10));
  addF(formula("shield_value", "忠诚激励自身护盾值", ADD(P("shield_base"), MUL(P("shield_ap_ratio"), AP())), "对应ShieldCalc。", 20));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
  w.effects.push(shieldEffect("self_shield", "忠诚激励自身普通护盾", "补证保留自身护盾资格。", "shield_value", "shield_duration_ms", 100));
}, [{ item: "周围额外敌人伤害", reason: "唯一敌方范围不建额外目标。" }], [{ item: "两颗飞弹重复护盾和施法字段冲突", reason: "只保存一次护盾，0.25与0不任选。" }], "保留自身普通护盾与唯一敌人伤害减速。");

define("Renata", "R", "恶意收购", 3, (add, addF, w) => {
  add(spLevel("Renata", "R", "BerserkDuration", 3, "berserk_duration_ms", "狂暴持续（毫秒）", "INTEGER", "等级索引1至3，秒转毫秒。", 10, toMs));
  add(spFixed("Renata", "R", "BonusAttackSpeed", "bonus_attack_speed_ratio", "狂暴攻击速度比例", "DECIMAL", "源值1，对应100%。", 20, 1));
  add(fixedTime("Renata", "R", "mCastTime"));
  w.effects.push(resourceEffect("mana", "mana_cost", "复用冻结公共法力参数；"));
}, [{ item: "被狂暴目标攻击第二单位", reason: "唯一敌方场景无可编造友军事件。" }], [{ item: "狂暴目标选择和控制行为", reason: "只留时长与攻速数值。" }], "保留唯一敌人狂暴时长和100%攻速，不虚构第二目标。");

const order = [
  "bard_p", "bard_q", "bard_w", "bard_e", "bard_r",
  "milio_p", "milio_q", "milio_w", "milio_e", "milio_r",
  "rakan_p", "rakan_q", "rakan_w", "rakan_e", "rakan_r",
  "renata_p", "renata_q", "renata_w", "renata_e", "renata_r",
];
assert(Object.keys(defs).length === 20, "技能槽不是20个");
for (const key of order) for (const item of defs[key].write.parameters)
  if (item.valueMode === "RUNTIME_INPUT") assert(item.fixedValue === null && item.levelValues === null, "运行输入带默认：" + key + "/" + item.parameterKey);

const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const routes = { parameters: "parameters", formulas: "formulas", effects: "effects", processes: "processes", internalStates: "internal-states", triggerRules: "trigger-rules" };
const keys = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" };
const writes = order.flatMap(skillKey => kinds.flatMap(kind => defs[skillKey].write[kind].map(body => ({ skillKey, kind, body }))));
const requestCounts = Object.fromEntries(kinds.map(kind => [kind, writes.filter(item => item.kind === kind).length]));
const requests = writes.map((item, index) => {
  const stableKey = item.body[keys[item.kind]];
  assert(stableKey, "缺少稳定键：" + item.skillKey + "/" + item.kind);
  return {
    sequence: index + 1, method: "POST",
    route: "/skills/" + item.skillKey + "/" + routes[item.kind],
    detailRoute: "/skills/" + item.skillKey + "/" + routes[item.kind] + "/" + stableKey,
    skillKey: item.skillKey, kind: item.kind, stableKey, status: "仅意图，未调用", body: item.body,
  };
});
const protectedCounts = {
  GETs: snapshot.GETs, subjects: order.length, currentCompositionSkillSlots: order.length,
  currentCompositionLists: order.length * 6, reusedPublicParameters: reuseList.length,
  images: order.length, characters: binding.heroes.length, characterSkillRelations: binding.heroes.length, dictionaries: 4,
};
const protectedRoutes = [...new Set((snapshot.requests || []).map(item => item.route))];
const protectedObjects = {
  subjects: order.map(skillKey => ({ skillKey, route: "/skills/" + skillKey, data: defs[skillKey].currentSubject, dataSha256: sha256(JSON.stringify(defs[skillKey].currentSubject)) })),
  currentCompositionLists: order.map(skillKey => ({ skillKey, routes: kinds.map(kind => "/skills/" + skillKey + "/" + routes[kind]), sourceSnapshot: "输入包/参考资料/当前20槽保护快照.json" })),
  reusedPublicParameters: reuseList.map(item => ({ ...item, post: false })),
  protectedReferenceRequests: snapshot.requests, protectedReferenceRoutes: protectedRoutes,
  protectedReferenceCounts: protectedCounts, scope: "20个技能槽主体、六类组成、代表图、角色关系、字典与25个公共参数均为保护对象。",
  snapshotFile: "输入包/参考资料/当前20槽保护快照.json", snapshotSha256: shaFile(snapshotFile),
};
const counts = {
  newParameters: requestCounts.parameters, newFormulas: requestCounts.formulas, newEffects: requestCounts.effects,
  newProcesses: requestCounts.processes, newInternalStates: requestCounts.internalStates, newTriggerRules: requestCounts.triggerRules,
  newTotal: requests.length, reusedPublicParameters: reuseList.length, plannedTotalIncludingReused: requests.length + reuseList.length,
  protectedCurrentCompositionLists: protectedCounts.currentCompositionLists,
};
const selectedValues = Object.fromEntries(order.map(skillKey => {
  const skill = defs[skillKey];
  return [skillKey, {
    binding: skill.source.spellPath, officialMaxRank: skill.maxLevel,
    rawDataValues: skill.source.raw.dataValues, rawFields: skill.source.raw.fields,
    calculations: skill.source.raw.calculations,
    selectedParameters: skill.write.parameters.map(item => ({ parameterKey: item.parameterKey, name: item.name, valueType: item.valueType, valueMode: item.valueMode, fixedValue: item.fixedValue, levelValues: item.levelValues })),
    formulas: skill.write.formulas.map(item => ({ formulaKey: item.formulaKey, expression: item.expression })),
    excluded: skill.excluded, pending: skill.pending,
  }];
}));
const sourceNotes = {
  arrayIndex: "技能等级数组统一读取DataValues索引1至最高等级；源树明确使用的索引0只保留其原义。",
  selector: "当前绑定树无显式mStat/mStatFormula；省略选择器的StatBy*按输入包窄证读取来源总法强。属性节点使用SOURCE/TARGET与TOTAL。",
  operations: "每个OPERATION严格两个操作数；树中的NumberCalculationPart先保存为固定参数。",
  resources: "25个公共冷却/法力参数只复用；巴德E、米利欧Q/E缺失端点才新增。资源效果只记录RESOURCE_CHANGE。",
  timing: "相同的根时间字段才保存；mCastTime与spellCastTime冲突只列待核，不补零。",
  semantics: "保留自身护盾、治疗、属性收益及同一敌人重复/再施放数值；排除第三友方、额外敌人和兵野专用支路。",
};
const sourceValues = {
  generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION,
  status: "独立原始源值摘要；未调用业务接口", sourceVersion: SOURCE_VERSION,
  sourceInputSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), sourceReview,
  inputIntegrity: Object.fromEntries(Object.entries(sourceFiles).map(([file, info]) => [file, info.sha256])),
  selectedValues, noApiCalls: true,
};
const candidate = {
  meta: {
    generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION,
    status: "候选已生成，等待主负责人审查；未调用业务接口", gameId: "lol", apiBase: API_BASE,
    sourceVersion: SOURCE_VERSION, scope: "巴德、米利欧、洛、烈娜塔20个技能槽；唯一敌方英雄一对一，保留自身收益和同敌人重复/再施放数值。",
    sourcePolicy: "固定客户端16.17、官方16.17.1与当前mLocKeys正文/计算树；未知曲线、属性口径、资格和时序无默认。",
    inputPackage: ".agents/artifacts/hero41-root-entry-20260910", currentSnapshot: "输入包/参考资料/当前20槽保护快照.json",
    currentSnapshotSha256: shaFile(snapshotFile), sourceInputSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile),
    sourceReview, businessWrites: 0, apiCalls: 0, tokenStored: false, candidateFileSha256: null,
  },
  skills: defs, order, reusedPublicParameters: reuseList.map(item => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false })),
  reusedExistingParameters: reuseList.map(item => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false })),
  counts, apiWrites: 0, sourceFiles, sourceNotes, protectedObjects,
};
const candidateBytes = JSON.stringify(candidate, null, 2) + "\n";
const candidateSha256 = sha256(candidateBytes);
const plan = {
  generatedAt: new Date().toISOString(), status: "仅写入意图，未调用业务接口；候选等待主负责人审查",
  batch: BATCH, revision: REVISION, apiBase: API_BASE, sourceVersion: SOURCE_VERSION,
  candidateSha256, sourceInputSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), sourceReview,
  protectionSnapshotSha256: shaFile(snapshotFile), publicReuseSha256: shaFile(reuseFile), requestCount: requests.length,
  requestCounts, currentTotalComponents: requests.length + reuseList.length, currentCompositionListsProtected: protectedCounts.currentCompositionLists,
  reusedPublicParameters: reuseList.map(item => ({ ...item, source: "输入包/参考资料/公共参数复用清单.json", post: false })),
  protectedSkills: order, protectedCounts, protectedRoutes, requests, noApiCalls: true, apiWrites: 0,
};
const planBytes = JSON.stringify(plan, null, 2) + "\n";
const planSha256 = sha256(planBytes);
const sourceValuesBytes = JSON.stringify(sourceValues, null, 2) + "\n";
const sourceValuesSha256 = sha256(sourceValuesBytes);
const sourceHashes = {
  generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, inputPackage: ".agents/artifacts/hero41-root-entry-20260910",
  sourceFiles, frozenHashes: {
    inputVersionSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), protectionSnapshotSha256: shaFile(snapshotFile),
    publicReuseSha256: shaFile(reuseFile), attributeBoundarySha256: shaFile(attributeFile), payloadSampleSha256: shaFile(payloadFile),
    cursorReviewSha256: sourceReview.conclusionSha256, cursorAuditSha256: sourceReview.auditSha256,
    cursorInputManifestSha256: sourceReview.inputManifestSha256, rangeDocSha256: shaFile(rangeFile),
    sourceNoteSha256: shaFile(sourceNoteFile), cursorSupplementSha256: shaFile(supplementFile),
  },
  outputs: { candidateSha256, planSha256, sourceValuesSha256 }, apiCalls: 0, apiWrites: 0,
};
const version = { generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, status: "candidate", candidateSha256, planSha256, sourceValuesSha256, counts, requestCount: requests.length, sourceReview, apiCalls: 0, apiWrites: 0 };
const sourceScope = {
  generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, status: "候选阶段，未调用业务接口", sourceVersion: SOURCE_VERSION, sourceInputSha256: shaFile(versionFile), sourceBindingSha256: shaFile(bindingFile), sourceReview,
  included: ["巴德P/Q/W/E/R：木灵、首敌、圣坛自用、传送和凝滞。", "米利欧P/Q/W/E/R：自身附加伤害、首敌、区域自用、护盾、治疗和韧性。", "洛P/Q/W/R：自身护盾、治疗、冲刺、唯一敌人伤害、移速与魅惑。", "烈娜塔P/Q/W/E/R：自身标记伤害、同敌人再施放、自身属性/护盾和唯一敌人狂暴。"],
  excluded: ["经验金币、纯第三友方、额外敌人、兵野专用、霞联动、建筑兵野结果及未消费匿名树。", "不创建DAMAGE、DIRECT_HEAL、MOMENT_EVALUATION、过程、内部状态或触发规则。"],
  unknown: ["角色等级曲线、灼烧中间曲线、属性/对象资格、周期事件、冲突施法字段、护盾治疗具体时点。"],
  perSkill: Object.fromEntries(order.map(skillKey => [skillKey, { excluded: defs[skillKey].excluded, pending: defs[skillKey].pending }])),
  counts, requestCount: requests.length, publicReuse: reuseList.length, protectedSummary: protectedCounts, noApiCalls: true,
};
const experience = [
  "# 第四十一批体验记录", "", "本批只生成静态候选和请求意图，未调用业务接口。20个技能槽的主体、六类组成、代表图、角色关系、字典与25个公共参数均受输入快照保护。", "",
  "- 巴德：木灵附加伤害和三种调和层数阈值来自计算树；W最低/满额治疗分开，法力回复和非战斗移速按补充说明保留。", "- 米利欧：P断点与灼烧未知曲线分开；Q首敌、W自身区域收益、E自身普通护盾和R治疗韧性分开。", "- 洛：P/Q角色等级基础值无默认；E第三友方排除；R只保留唯一敌人首次触碰。", "- 烈娜塔：P自身标记伤害乘目标生命；W正文3秒复活衰减不采用匿名2.5秒；E自身护盾与单敌伤害并存；R不虚构第二目标。", "", "候选不代表业务入库、页面验收或战斗运行；未确定曲线、资格、时序均列在来源与范围中。", "",
].join("\n");
const readme = [
  "# 第四十一批候选", "", "本目录保存巴德、米利欧、洛、烈娜塔20个技能槽的静态候选。来源固定客户端16.17、官方16.17.1和当前绑定正文；Cursor只读来源复核为READY（3290事件、70次工具、23个输入、业务写入0）。", "",
  "共" + counts.newParameters + "个新增参数、" + counts.newFormulas + "个新增公式、" + counts.newEffects + "个新增效果，共" + requests.length + "项新增请求意图；25个公共冷却/法力参数只复用。", "",
  "候选保留自身护盾、治疗和属性收益以及同一敌人的重复/再施放数值；未知曲线和实际输入使用无默认RUNTIME_INPUT，运算严格两个操作数。", "",
  "效果只使用RESOURCE_CHANGE、NORMAL_SHIELD和ATTRIBUTE_CHANGE，不创建DAMAGE、DIRECT_HEAL或MOMENT_EVALUATION。来源值摘要保存原始DataValues、计算树、当前绑定文本和官方中英文证据。", "",
  "文件入口：完整候选.json、请求计划.json、来源值摘要.json、来源与范围.json、来源哈希汇总.json、候选版本.json、体验报告.md。候选是静态设计证据。", "",
].join("\n");
const artifactFiles = {
  "完整候选.json": candidateBytes, "请求计划.json": planBytes, "来源值摘要.json": sourceValuesBytes,
  "来源与范围.json": JSON.stringify(sourceScope, null, 2) + "\n", "来源哈希汇总.json": JSON.stringify(sourceHashes, null, 2) + "\n",
  "候选版本.json": JSON.stringify(version, null, 2) + "\n", "README.md": readme, "体验报告.md": experience,
};
for (const [file, content] of Object.entries(artifactFiles)) write(path.join(ROOT, file), content);
fs.mkdirSync(DURABLE, { recursive: true });
for (const [file, content] of Object.entries(artifactFiles)) {
  write(path.join(DURABLE, file), content);
  assert(shaFile(path.join(ROOT, file)) === shaFile(path.join(DURABLE, file)), "持久目录字节不一致：" + file);
}
console.log(JSON.stringify({ batch: BATCH, revision: REVISION, counts, requestCount: requests.length, candidateSha256, planSha256, sourceValuesSha256, protectedCounts, apiCalls: 0, apiWrites: 0 }, null, 2));
