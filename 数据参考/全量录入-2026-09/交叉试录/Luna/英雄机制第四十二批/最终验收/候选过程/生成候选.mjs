import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero42-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十二批");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "英雄机制第四十二批";
const REVISION = "hero42-source-v1";
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const writeNew = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: "wx" });
};
const writeJsonNew = (file, value) => writeNew(file, jsonBytes(value));

const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const versionFile = path.join(INPUT, "输入版本.json");
const rangeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const sourceAuditFile = path.join(INPUT, "主负责人源值核对说明.md");
const inputReadmeFile = path.join(INPUT, "README.md");
const cursorDir = path.resolve(".agents/artifacts/hero42-cursor-review-run-20260910");
const cursorConclusionFile = path.join(cursorDir, "Cursor来源复核结论.md");
const cursorAuditFile = path.join(cursorDir, "主负责人执行审计.json");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const attributeFile = path.join(INPUT, "参考资料", "属性默认与边界.json");
const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const attributeNarrow = readJson(attributeFile);
const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const subjectByRoute = new Map(protection.requests.filter(x => /^\/skills\/[^/]+$/.test(x.route)).map(x => [x.route, x.data]));
const protectedRouteHashes = protection.requests.map(x => ({ route: x.route, status: x.status, dataSha256: sha256(JSON.stringify(x.data)) }));
const skillAt = (hero, slot) => sourceSkills[hero]?.[slot] || (() => { throw new Error("缺少源技能 " + hero + "/" + slot); })();
const spell = (hero, slot) => skillAt(hero, slot).object.mSpell;
const dataRow = (hero, slot, name) => {
  const row = (spell(hero, slot).DataValues || []).find(x => x.name === name);
  if (!row || !Array.isArray(row.values)) throw new Error("缺少DataValue " + hero + "/" + slot + "/" + name);
  return row.values;
};
const dataAt = (hero, slot, name, index = 1) => dataRow(hero, slot, name)[index];
const calc = (hero, slot, name) => {
  const value = (spell(hero, slot).mSpellCalculations || {})[name];
  if (!value) throw new Error("缺少计算树 " + hero + "/" + slot + "/" + name);
  return value;
};
const part = (hero, slot, name, index = 0) => calc(hero, slot, name).mFormulaParts[index];
const coefficient = (hero, slot, name, index = 1) => part(hero, slot, name, index).mCoefficient;
const levels = (hero, slot, name, max, transform = x => x) => Object.fromEntries(Array.from({ length: max }, (_, i) => [String(i + 1), transform(dataAt(hero, slot, name, i + 1))]));
const toMs = seconds => {
  const value = Math.round(seconds * 1000);
  if (!Number.isFinite(value) || Math.abs(value - seconds * 1000) > 1e-3 || value < 0) throw new Error("时间不是非负整数毫秒：" + seconds);
  return value;
};
const pp = value => value * 100;
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (a, b) => O("ADD", a, b);
const MUL = (a, b) => O("MULTIPLY", a, b);
const SUB = (a, b) => O("SUBTRACT", a, b);
const totalAD = () => A("SOURCE", "attack_damage", "TOTAL");
const bonusAD = () => A("SOURCE", "attack_damage", "BONUS");
const targetHP = () => A("TARGET", "hp", "TOTAL");
const sourceHPBonus = () => A("SOURCE", "hp", "BONUS");
const sourceArmorBonus = () => A("SOURCE", "armor", "BONUS");
const sourceMRBonus = () => A("SOURCE", "magic_resistance", "BONUS");
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const fixed = (key, name, type, value, description, order) => ({ parameterKey: key, name, valueType: type, valueMode: "FIXED", fixedValue: value, levelValues: null, description, sortOrder: order });
const skill = (key, name, type, values, description, order) => ({ parameterKey: key, name, valueType: type, valueMode: "SKILL_LEVEL", fixedValue: null, levelValues: values, description, sortOrder: order });
const runtime = (key, name, type, description, order) => ({ parameterKey: key, name, valueType: type, valueMode: "RUNTIME_INPUT", fixedValue: null, levelValues: null, description, sortOrder: order });
const f = (key, name, expression, description, order) => ({ formulaKey: key, name, expression, description, sortOrder: order });
const officialFor = (hero, slot, english = false) => {
  const root = readJson(path.join(INPUT, "参考资料", english ? "官方英文" : "官方中文", hero + ".json")).data[hero];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};
const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const meta = hero.source.skills.find(x => x.slot === slot);
  const rawSpell = skillAt(heroId, slot).object.mSpell;
  const raw = {
    dataValues: Object.fromEntries((rawSpell.DataValues || []).map(row => [row.name, row.values ? row.values.slice() : null])),
    calculations: clone(rawSpell.mSpellCalculations || {}),
    fields: Object.fromEntries(["spellCastTime", "mCastTime", "spellTotalTime", "mChannelDuration", "cooldownTime", "mana", "manaValues", "mMaxAmmo", "mAmmoRechargeTime", "mDoesNotConsumeMana", "mDoesNotConsumeCooldown"].map(key => [key, rawSpell[key] ?? null]))
  };
  return {
    hero: heroId, heroName: hero.name, heroKey: hero.key, slot, resourceType: hero.source.resourceType,
    rootPath: hero.rootPath, spellPath: meta.clientPath, bindingAvailable: meta.bindingAvailable,
    clientFile: "参考资料/客户端原文/" + heroId + ".json.gz",
    clientSha256: shaFile(path.join(INPUT, "参考资料", "客户端原文", heroId + ".json.gz")),
    clientCompressedSha256: hero.source.client.compressedSha256, clientBuild: hero.source.client.contentVersion,
    officialZhFile: "参考资料/官方中文/" + heroId + ".json", officialZhSha256: shaFile(path.join(INPUT, "参考资料", "官方中文", heroId + ".json")),
    officialEnFile: "参考资料/官方英文/" + heroId + ".json", officialEnSha256: shaFile(path.join(INPUT, "参考资料", "官方英文", heroId + ".json")),
    currentBoundText: clone(skillAt(heroId, slot).currentTexts), raw,
    officialEvidence: { zh: clone(officialFor(heroId, slot)), en: clone(officialFor(heroId, slot, true)) },
    currentTextPath: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot + "/currentTexts"
  };
};
const defs = {};
const define = (heroId, slot, name, maxLevel, build, excluded = [], pending = [], proofNote = "") => {
  const write = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  build(x => write.parameters.push(x), x => write.formulas.push(x));
  const skillKey = heroId.toLowerCase() + "_" + slot.toLowerCase();
  defs[skillKey] = {
    skillKey, name: heroes[heroId].name + "·" + name, maxLevel, source: sourceFor(heroId, slot), write,
    protectedExisting: { subject: subjectByRoute.has("/skills/" + skillKey), compositionLists: true, protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json" },
    excluded, pending, proofs: [
      { type: "root-bound-source", path: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot },
      { type: "fixed-source-version", client: binding.clientVersion, official: binding.officialVersion, build: heroes[heroId].source.client.contentVersion }
    ],
    proofNote, currentSubject: subjectByRoute.get("/skills/" + skillKey) || null
  };
};

define("Qiyana", "P", "凌人贵气", 1, (add, addFormula) => {
  add(runtime("actual_character_level_base_damage", "当前角色等级被动基础伤害", "DECIMAL", "FinalDamage角色等级树原始为1级15、每级初始增量4，6/11级斜率仍为4；不自行展开未证求值，不设默认。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", dataAt("Qiyana", "P", "BonusADRatio"), "FinalDamage的mStat=2、mStatFormula=2，绑定BonusADRatio，读取来源额外攻击力。", 20));
  add(fixed("ap_ratio", "法强倍率", "DECIMAL", dataAt("Qiyana", "P", "APRatio"), "FinalDamage省略统计选择器，按同版窄证读取来源总法强。", 30));
  add(fixed("per_target_cooldown_ms", "每目标效果冷却（毫秒）", "INTEGER", 25000, "当前中文正文明确每目标25秒；不采用未消费ICD=14秒。", 40));
  addFormula(f("passive_physical_damage", "凌人贵气单次物理伤害", ADD(ADD(P("actual_character_level_base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), MUL(P("ap_ratio"), AP())), "FinalDamage=当前等级基础项+0.25×来源额外攻击力+0.3×来源总法强。", 10));
}, [{ item: "ICD=14秒及未消费治疗/范围树", reason: "当前正文只消费每目标25秒和额外伤害；不造周期、治疗或范围效果。" }], [{ item: "等级基础项求值", reason: "原始15、每级4及6/11断点保留在来源，运行层提供当前实际基础项。" }, { item: "附魔重置事件", reason: "同目标重置资格保留，事件待接线。" }], "只录当前唯一敌人首次命中的混合伤害和正文目标冷却。");
define("Qiyana", "Q", "元素之怒 / 以绪塔尔之锋", 5, (add, addFormula) => {
  add(skill("base_damage", "元素之怒基础物理伤害", "INTEGER", levels("Qiyana", "Q", "BaseDamage", 5), "VanillaBase/BaseDamage索引1至5为80/110/140/170/200；索引0的50不作1级。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", coefficient("Qiyana", "Q", "EnchantedDamage", 1), "EnchantedDamage与VanillaDamage的mStat=2/formula2，系数0.9，读取来源额外攻击力。", 20));
  add(fixed("ice_root_duration_ms", "寒冰附魔禁锢持续（毫秒）", "INTEGER", toMs(dataAt("Qiyana", "Q", "RootDuration")), "当前根RootDuration=0.5秒。", 30));
  add(fixed("ice_slow_percent_points", "寒冰附魔减速百分数点", "DECIMAL", pp(-dataAt("Qiyana", "Q", "SlowPotency")), "正文使用SlowPotency*-100%，原始负值转为正20百分数点。", 40));
  add(fixed("ice_slow_duration_ms", "寒冰附魔减速持续（毫秒）", "INTEGER", toMs(dataAt("Qiyana", "Q", "SlowDuration")), "正文消费SlowDuration=1秒。", 50));
  add(fixed("wildwood_stealth_duration_ms", "荒野附魔隐形持续（毫秒）", "INTEGER", toMs(dataAt("Qiyana", "Q", "StealthDuration")), "正文消费StealthDuration=3秒。", 60));
  add(fixed("wildwood_move_speed_percent_points", "荒野附魔自身移动速度百分数点", "DECIMAL", pp(dataAt("Qiyana", "Q", "Haste")), "正文使用Haste*100%，为20百分数点。", 70));
  add(fixed("rock_execute_threshold_percent_points", "岩石附魔低生命阈值百分数点", "DECIMAL", pp(dataAt("Qiyana", "Q", "CritThreshold")), "正文使用CritThreshold*100%，低于50百分数点才有附加伤害资格。", 80));
  add(runtime("rock_damage_multiplier", "岩石附魔当前伤害倍率", "DECIMAL", "TremorDamage树角色等级起点为0.6，6/11空断点无算法证据；运行层提供当前倍率，不设默认。", 90));
  add(fixed("rock_explosion_delay_ms", "岩石爆炸原始延迟（毫秒）", "INTEGER", toMs(dataAt("Qiyana", "Q", "RockExplosionDelay")), "只记录原始0.4秒时序，不并入施法时间或伤害周期。", 100));
  const core = () => ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD()));
  addFormula(f("vanilla_physical_damage", "无附魔单敌物理伤害", core(), "VanillaDamage=基础值+0.9×来源额外攻击力。", 10));
  addFormula(f("enchanted_physical_damage", "附魔单敌物理伤害", core(), "EnchantedDamage=基础值+0.9×来源额外攻击力。", 20));
  addFormula(f("rock_bonus_physical_damage", "岩石附魔低生命额外物理伤害", MUL(P("rock_damage_multiplier"), core()), "TremorDamage=当前岩石倍率×完整附魔伤害。", 30));
}, [{ item: "Falloff及野怪160%分支", reason: "后续敌人和野怪专用。" }, { item: "TremorBonus=0.4", reason: "当前消费是0.6乘EnchantedDamage，旧同名值不替代当前树。" }], [{ item: "岩石资格和延迟", reason: "阈值、原始延迟和伤害式已录，事件待接线。" }, { item: "岩石等级倍率", reason: "仅有0.6起点，空断点不展开。" }], "保留无附魔、附魔和岩石附加的同敌分支。");
define("Qiyana", "W", "方圆塑令", 5, (add, addFormula) => {
  add(skill("enchant_attack_speed_percent_points", "附魔期间攻击速度百分数点", "DECIMAL", levels("Qiyana", "W", "AttackSpeed", 5, pp), "正文使用AttackSpeed*100%，为15/20/25/30/35百分数点。", 10));
  add(skill("onhit_base_damage", "附魔攻击额外基础魔法伤害", "INTEGER", levels("Qiyana", "W", "BaseDamage", 5), "OnHitDamage的BaseDamage索引1至5。", 20));
  add(fixed("onhit_ap_ratio", "附魔攻击法强倍率", "DECIMAL", dataAt("Qiyana", "W", "OnHitAPRatio"), "读取来源总法强。", 30));
  add(fixed("onhit_bonus_ad_ratio", "附魔攻击额外攻击力倍率", "DECIMAL", dataAt("Qiyana", "W", "OnHitADRatio"), "OnHitDamage的mStat=2/formula2，读取来源额外攻击力。", 40));
  add(skill("terrain_move_speed_percent_points", "对应地形非战斗移动速度百分数点", "DECIMAL", levels("Qiyana", "W", "PassiveMS", 5, pp), "正文使用PassiveMS*100%，为3/5/7/9/11百分数点。", 50));
  add(fixed("terrain_distance", "对应地形判定距离", "INTEGER", dataAt("Qiyana", "W", "Range"), "当前根Range=425。", 60));
  add(fixed("dash_distance", "主动地形位移距离", "INTEGER", dataAt("Qiyana", "W", "TravelDistance"), "当前根TravelDistance=300；空TravelDistanceShort不补零。", 70));
  add(fixed("dash_speed", "主动地形位移速度", "INTEGER", dataAt("Qiyana", "W", "DashSpeed"), "当前根DashSpeed=440。", 80));
  addFormula(f("onhit_magic_damage", "附魔攻击额外魔法伤害", ADD(ADD(P("onhit_base_damage"), MUL(P("onhit_ap_ratio"), AP())), MUL(P("onhit_bonus_ad_ratio"), bonusAD())), "OnHitDamage=基础值+0.45×来源总法强+0.2×来源额外攻击力。", 10));
}, [{ item: "CleaveDamage/TremorDamage及空TravelDistanceShort", reason: "当前正文不消费旧树，空值不补零。" }], [{ item: "元素互斥、Q刷新和附魔状态", reason: "正文机制保留，事件待接线。" }], "保留附魔攻速、附魔攻击魔伤、地形移速和主动位移输入。");
define("Qiyana", "E", "天纵之勇", 5, (add, addFormula) => {
  add(skill("base_damage", "天纵之勇基础物理伤害", "INTEGER", levels("Qiyana", "E", "BaseDamage", 5), "BaseDamage索引1至5为50/90/130/170/210。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", dataAt("Qiyana", "E", "ADRatio"), "Damage的mStat=2/formula2，读取来源额外攻击力。", 20));
  add(fixed("dash_speed_min", "冲刺速度下界", "INTEGER", dataAt("Qiyana", "E", "DashSpeed"), "当前根DashSpeed=600；中间算法未证。", 30));
  add(fixed("dash_speed_max", "冲刺速度上界", "INTEGER", dataAt("Qiyana", "E", "DashSpeedMax"), "当前根DashSpeedMax=1200；中间算法未证。", 40));
  addFormula(f("physical_damage", "天纵之勇对英雄物理伤害", ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), "Damage=基础值+0.5×来源额外攻击力。", 10));
}, [{ item: "SWIFTPLAY/cherry", reason: "模式专用分支。" }], [{ item: "冲刺速度中间曲线和E命中英雄自动瞄准Q", reason: "保留边界与跨技能资格，事件待接线。" }], "保留唯一敌方伤害和自动瞄准资格。");
define("Qiyana", "R", "惊才绝景", 3, (add, addFormula) => {
  add(skill("base_damage", "惊才绝景基础物理伤害", "INTEGER", levels("Qiyana", "R", "BaseDamage", 3), "BaseDamage索引1至3为100/200/300。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", coefficient("Qiyana", "R", "Damage", 1), "Damage的mStat=2/formula2，系数1.25，读取来源额外攻击力。", 20));
  add(fixed("target_max_health_ratio", "目标最大生命比例", "DECIMAL", dataAt("Qiyana", "R", "PercentHPDamageBaseRock"), "正文明确目标最大生命10%，不因计算名MissingHealth反转。", 30));
  add(fixed("stun_duration_min_ms", "晕眩持续下限（毫秒）", "INTEGER", toMs(dataAt("Qiyana", "R", "StunDurationMin")), "正文明确0.5秒下限。", 40));
  add(fixed("stun_duration_max_ms", "晕眩持续上限（毫秒）", "INTEGER", toMs(dataAt("Qiyana", "R", "StunDuration")), "正文明确1秒上限。", 50));
  addFormula(f("environment_explosion_physical_damage", "墙体或地形爆炸对敌物理伤害", ADD(ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), MUL(P("target_max_health_ratio"), targetHP())), "Damage=基础值+1.25×来源额外攻击力+10%目标最大生命。", 10));
}, [{ item: "MonsterCap及未消费Slow/Recast", reason: "野怪或无当前正文消费者。" }], [{ item: "晕眩距离曲线和墙河草触发", reason: "保留0.5至1秒边界及同敌重复引爆，事件待接线。" }], "保留同一敌人的环境爆炸伤害。");

define("KSante", "P", "血性本能", 1, (add, addFormula) => {
  add(fixed("mark_duration_ms", "标记持续（毫秒）", "INTEGER", toMs(dataAt("KSante", "P", "MarkDuration")), "伤害技能标记持续4秒。", 10));
  add(fixed("flat_damage", "标记消耗固定物理伤害", "INTEGER", dataAt("KSante", "P", "FlatDamage"), "正文直接消费FlatDamage=12。", 20));
  add(fixed("mark_target_max_health_ratio_min", "标记消耗目标最大生命比例下界", "DECIMAL", dataAt("KSante", "P", "MarkDamagePercentMin"), "正文PercentHealthDamage下界1%。", 30));
  add(fixed("mark_target_max_health_ratio_max", "标记消耗目标最大生命比例上界", "DECIMAL", dataAt("KSante", "P", "MarkDamagePercentMax"), "正文PercentHealthDamage上界2%。", 40));
  add(runtime("mark_target_max_health_ratio", "当前标记消耗目标最大生命比例", "DECIMAL", "运行层提供1%至2%范围内当前比例；中间等级未证，不设默认。", 50));
  addFormula(f("marked_attack_physical_damage", "标记消耗攻击物理伤害", ADD(P("flat_damage"), MUL(P("mark_target_max_health_ratio"), targetHP())), "FlatDamage+当前比例×目标最大生命。", 10));
}, [{ item: "全盛姿态额外伤害、防御变换及兵野上下限", reason: "完整变形/姿态或兵野分支首轮跳过。" }, { item: "匿名281dd874", reason: "普通正文未消费。" }], [{ item: "标记施加和攻击消耗事件", reason: "数值已录，事件待接线。" }], "只录普通形态标记消耗式。");
define("KSante", "Q", "无双陀斧", 5, (add, addFormula) => {
  add(skill("base_damage", "无双陀斧基础物理伤害", "INTEGER", levels("KSante", "Q", "FlatDamage", 5), "FlatDamage索引1至5为70/100/130/160/190。", 10));
  add(runtime("bonus_armor_value", "当前来源额外护甲", "DECIMAL", "BaseDamage的mStat=1/formula2；属性阶段未证，不设默认。", 20));
  add(runtime("bonus_magic_resistance_value", "当前来源额外魔法抗性", "DECIMAL", "BaseDamage的mStat=6/formula2；属性阶段未证，不设默认。", 30));
  add(fixed("bonus_armor_ratio", "额外护甲倍率", "DECIMAL", coefficient("KSante", "Q", "BaseDamage", 1), "系数0.4，乘来源额外护甲运行输入。", 40));
  add(fixed("bonus_magic_resistance_ratio", "额外魔抗倍率", "DECIMAL", coefficient("KSante", "Q", "BaseDamage", 2), "系数0.4，乘来源额外魔抗运行输入。", 50));
  add(fixed("slow_percent_points", "减速百分数点", "DECIMAL", pp(dataAt("KSante", "Q", "SlowPercent")), "正文使用SlowPercent*100%，为80百分数点。", 60));
  add(fixed("slow_duration_ms", "减速持续（毫秒）", "INTEGER", toMs(dataAt("KSante", "Q", "SlowDuration")), "正文消费0.5秒。", 70));
  add(fixed("recast_window_ms", "层数窗口（毫秒）", "INTEGER", toMs(dataAt("KSante", "Q", "RecastWindow")), "正文消费6秒。", 80));
  add(fixed("stun_duration_ms", "Q3正文晕眩持续（毫秒）", "INTEGER", toMs(dataAt("KSante", "Q", "StunDuration")), "正文消费1秒。", 90));
  add(fixed("q3_knockup_duration_ms", "Q3原始击飞持续（毫秒）", "INTEGER", toMs(dataAt("KSante", "Q", "KnockupDuration")), "原始树0.65秒，和正文1秒晕眩分开保存。", 100));
  add(fixed("defense_cap", "额外防御冷却计算门槛", "INTEGER", dataAt("KSante", "Q", "DefenseCapforCooldown"), "扩展正文消费120；实际折算式未知。", 110));
  add(fixed("cast_time_min_ms", "施放时间下界（毫秒）", "INTEGER", toMs(dataAt("KSante", "Q", "MinCastTime")), "只作0.35秒边界。", 120));
  add(fixed("cast_time_max_ms", "施放时间上界（毫秒）", "INTEGER", toMs(dataAt("KSante", "Q", "MaxCastTime")), "只作0.45秒边界，不任选mCastTime固定值。", 130));
  addFormula(f("physical_damage", "无双陀斧对敌物理伤害", ADD(ADD(P("base_damage"), MUL(P("bonus_armor_ratio"), P("bonus_armor_value"))), MUL(P("bonus_magic_resistance_ratio"), P("bonus_magic_resistance_value"))), "BaseDamage=基础值+0.4×额外护甲+0.4×额外魔抗。", 10));
}, [{ item: "全盛冷却缩短和替换链、匿名层数树", reason: "完整变形/姿态或未证匿名规则。" }], [{ item: "额外抗性影响冷却/施法和Q3资格", reason: "保留门槛、边界和层窗口，折算与事件待核。" }], "属性两路坚持无默认实际输入。");
define("KSante", "W", "辟路先锋", 5, (add, addFormula) => {
  add(skill("base_damage", "辟路先锋基础物理伤害", "INTEGER", levels("KSante", "W", "BaseDamage", 5), "BaseDamage索引1至5为45/75/105/135/165。", 10));
  add(fixed("target_max_health_base_ratio", "目标最大生命基础比例", "DECIMAL", dataAt("KSante", "W", "MaxHealthDamage"), "TotalMaxHealthDamage基础8%。", 20));
  add(fixed("bonus_armor_ratio", "额外护甲对生命比例", "DECIMAL", dataAt("KSante", "W", "MaxHealthDamageResistRatio"), "mStat=1/formula2，系数0.0002。", 30));
  add(fixed("bonus_magic_resistance_ratio", "额外魔抗对生命比例", "DECIMAL", dataAt("KSante", "W", "MaxHealthDamageResistRatio"), "mStat=6/formula2，系数0.0002。", 40));
  add(runtime("bonus_armor_value", "当前来源额外护甲", "DECIMAL", "TotalMaxHealthDamage的mStat=1/formula2，属性阶段未证，不设默认。", 50));
  add(runtime("bonus_magic_resistance_value", "当前来源额外魔抗", "DECIMAL", "TotalMaxHealthDamage的mStat=6/formula2，属性阶段未证，不设默认。", 60));
  add(fixed("charge_min_duration_ms", "蓄力下限（毫秒）", "INTEGER", toMs(dataAt("KSante", "W", "MinDurationTOOLTIP")), "正文消费0.4秒。", 70));
  add(fixed("charge_max_duration_ms", "蓄力上限（毫秒）", "INTEGER", toMs(dataAt("KSante", "W", "MaxDuration")), "正文消费1秒。", 80));
  add(fixed("full_effect_charge_percent_points", "达到最大效果的蓄力百分数点", "DECIMAL", pp(dataAt("KSante", "W", "TimeToFullCharge")), "正文使用TimeToFullCharge*100%，为90百分数点。", 90));
  add(fixed("self_damage_reduction_percent_points", "普通形态自身减伤百分数点", "DECIMAL", pp(dataAt("KSante", "W", "DamageReduction")), "普通形态30百分数点。", 100));
  add(fixed("knockback_stun_min_ms", "击退晕眩下限（毫秒）", "INTEGER", toMs(dataAt("KSante", "W", "MinKnockbackDuration")), "正文消费0.5秒。", 110));
  add(fixed("knockback_stun_max_ms", "击退晕眩上限（毫秒）", "INTEGER", toMs(dataAt("KSante", "W", "MaxKnockbackDuration")), "正文消费1.75秒。", 120));
  add(fixed("dash_speed_base", "普通形态冲刺速度", "INTEGER", dataAt("KSante", "W", "DashSpeedBase"), "当前根1400。", 130));
  add(fixed("dash_distance_min", "冲刺距离下界", "INTEGER", dataAt("KSante", "W", "MinDashBase"), "当前根100。", 140));
  add(fixed("dash_distance_max", "冲刺距离上界", "INTEGER", dataAt("KSante", "W", "MaxDashBase"), "当前根450。", 150));
  const ratio = ADD(ADD(P("target_max_health_base_ratio"), MUL(P("bonus_armor_ratio"), P("bonus_armor_value"))), MUL(P("bonus_magic_resistance_ratio"), P("bonus_magic_resistance_value")));
  addFormula(f("target_max_health_damage_ratio", "蓄力目标最大生命伤害比例", ratio, "TotalMaxHealthDamage=8%+0.0002×额外护甲+0.0002×额外魔抗。", 10));
  addFormula(f("charge_physical_damage", "辟路先锋普通形态物理伤害", ADD(P("base_damage"), MUL(ratio, targetHP())), "BaseDamage+TotalMaxHealthDamage×目标最大生命。", 20));
}, [{ item: "全盛真实伤害/减伤/控制替换及兵野上限", reason: "完整变形/姿态和兵野分支跳过。" }], [{ item: "蓄力中间曲线和属性阶段", reason: "仅保留边界、90%和无默认属性输入。" }], "普通形态目标最大生命伤害保持完整。");
define("KSante", "E", "大步驰援", 5, (add, addFormula) => {
  add(skill("shield_base", "自身护盾基础值", "DECIMAL", levels("KSante", "E", "ShieldBaseAmountFast", 5), "索引1至5为70/112.5/155/197.5/240。", 10));
  add(fixed("bonus_hp_ratio", "额外生命护盾倍率", "DECIMAL", dataAt("KSante", "E", "ShieldHealthRatio"), "TotalShield的mStat=12/formula2，读取来源额外生命。", 20));
  add(fixed("shield_duration_ms", "自身护盾持续（毫秒）", "INTEGER", toMs(dataAt("KSante", "E", "ShieldDuration")), "正文消费2秒。", 30));
  add(fixed("free_dash_range", "自身自由位移距离", "INTEGER", dataAt("KSante", "E", "FreeTargetRangeBase"), "普通形态250。", 40));
  add(fixed("free_dash_speed", "自身自由位移速度", "INTEGER", dataAt("KSante", "E", "FreeTargetSpeedBase"), "普通形态550。", 50));
  addFormula(f("self_shield_amount", "自身护盾值", ADD(P("shield_base"), MUL(P("bonus_hp_ratio"), sourceHPBonus())), "TotalShield=基础护盾+0.135×来源额外生命。", 10));
}, [{ item: "友方护盾/延长位移及全盛速度", reason: "第三友方或完整变形分支。" }], [{ item: "护盾施加时点", reason: "数值和持续已录，事件待接线。" }], "只保留自身护盾和自由位移。");
define("KSante", "R", "傲岸雄姿", 3, (add, addFormula) => {
  add(skill("initial_damage", "变形前首次击退基础物理伤害", "INTEGER", levels("KSante", "R", "BaseDamage", 3), "索引1至3为80/115/150，只保留变形前本体。", 10));
  add(skill("slam_base_damage", "穿墙后第二段基础物理伤害", "INTEGER", levels("KSante", "R", "SlamDownStrikeDamage", 3), "索引1至3为80/115/150，同一敌人再次命中保留。", 20));
  add(fixed("slam_bonus_hp_ratio", "穿墙第二段额外生命倍率", "DECIMAL", coefficient("KSante", "R", "TotalDamageSlamDown", 1), "TotalDamageSlamDown的mStat=12/formula2，系数0.05。", 30));
  add(fixed("cast_time_ms", "R施法时间（毫秒）", "INTEGER", toMs(spell("KSante", "R").spellCastTime), "spellCastTime与mCastTime均为0.4秒且一致。", 40));
  addFormula(f("slam_down_physical_damage", "穿墙后同敌第二段物理伤害", ADD(P("slam_base_damage"), MUL(P("slam_bonus_hp_ratio"), sourceHPBonus())), "第二段基础值+0.05×来源额外生命。", 10));
}, [{ item: "全盛15秒及属性转换链", reason: "完整变形链按根决策跳过。" }], [{ item: "击退穿墙资格和控制事件", reason: "两段数值保留，事件待接线。" }], "只保留变形前首次和穿墙后同敌第二段。");

define("Mel", "P", "灼灼之光", 1, (add, addFormula) => {
  add(fixed("overwhelm_duration_ms", "夺命残影持续（毫秒）", "INTEGER", toMs(dataAt("Mel", "P", "OverwhelmDuration")), "正文消费5秒。", 10));
  add(fixed("bonus_attack_duration_ms", "技能后额外弹体窗口（毫秒）", "INTEGER", toMs(dataAt("Mel", "P", "BonusAttackDuration")), "当前根为5秒，只记录窗口。", 20));
  add(fixed("passive_bonus_missiles", "技能后额外弹体数量", "INTEGER", dataAt("Mel", "P", "PassiveBonusMissiles"), "正文明确3枚。", 30));
  add(fixed("max_passive_bonus_missiles", "额外弹体数量上限", "INTEGER", dataAt("Mel", "P", "MaxPassiveBonusMissiles"), "正文明确9枚。", 40));
  add(fixed("unlearned_r_passive_flat_damage", "未学习R时残影基础魔法伤害", "INTEGER", dataAt("Mel", "R", "BasePassiveFlatDamage", 0), "P跨技能消费R的零级索引0=50；不冒充R一级。", 50));
  add(fixed("unlearned_r_passive_stack_damage", "未学习R时残影每层魔法伤害", "INTEGER", dataAt("Mel", "R", "BasePassiveStackDamage", 0), "P跨技能消费R的零级索引0=2。", 60));
  add(runtime("overwhelm_stack_count", "当前夺命残影层数", "INTEGER", "处决比较所需当前目标层数，跨技能零级规则不设默认。", 70));
  add(runtime("actual_character_level_passive_missile_base_damage", "当前角色等级额外弹体基础伤害", "DECIMAL", "PassiveBonusMissileDamage仅有8至30插值端点，运行层提供当前基础项，不设默认。", 80));
  add(fixed("passive_missile_ap_ratio", "额外弹体法强倍率", "DECIMAL", coefficient("Mel", "P", "PassiveBonusMissileDamage", 1), "省略统计选择器，按窄证读取来源总法强。", 90));
  addFormula(f("overwhelm_threshold_damage", "夺命残影储量阈值魔法伤害", ADD(P("unlearned_r_passive_flat_damage"), MUL(P("unlearned_r_passive_stack_damage"), P("overwhelm_stack_count"))), "未学习R时50+2×层数；R等级提升的跨技能取值待系统支持。", 10));
  addFormula(f("passive_bonus_missile_damage", "额外弹体单弹魔法伤害", ADD(P("actual_character_level_passive_missile_base_damage"), MUL(P("passive_missile_ap_ratio"), AP())), "当前等级基础项+0.04×来源总法强。", 20));
}, [{ item: "小兵残影削减", reason: "兵线专用。" }], [{ item: "R零级跨技能、层数和8至30曲线", reason: "零级50/2、层数公式和插值端点已保存，取值与事件待接线。" }], "不丢弃MelP对未学习R索引0的消费。");
define("Mel", "Q", "耀光齐射", 5, (add, addFormula) => {
  add(skill("explosion_count", "耀光飞弹数量", "INTEGER", levels("Mel", "Q", "ExplosionCount", 5), "索引1至5为6/7/8/9/10。", 10));
  add(skill("initial_base_damage", "首次爆炸基础魔法伤害", "INTEGER", levels("Mel", "Q", "InitialDamage", 5), "索引1至5为60/85/110/135/160。", 20));
  add(skill("following_base_damage", "后续爆炸基础魔法伤害", "INTEGER", levels("Mel", "Q", "ExplosionDamage", 5), "索引1至5为5/7/9/11/13。", 30));
  add(fixed("initial_ap_ratio", "首次爆炸法强倍率", "DECIMAL", coefficient("Mel", "Q", "InitialExplosionDamage", 1), "系数0.55，读取来源总法强。", 40));
  add(fixed("following_ap_ratio", "后续爆炸法强倍率", "DECIMAL", coefficient("Mel", "Q", "TotalExplosionDamage", 1), "系数0.05，读取来源总法强。", 50));
  add(fixed("channel_duration_ms", "弹幕持续（毫秒）", "INTEGER", toMs(dataAt("Mel", "Q", "ChannelDuration")), "当前根0.5秒。", 60));
  add(fixed("unit_count", "总式固定减一单位", "INTEGER", 1, "AllDamageHit树中的固定1，用于爆炸数量减一。", 70));
  const first = ADD(P("initial_base_damage"), MUL(P("initial_ap_ratio"), AP()));
  const later = ADD(P("following_base_damage"), MUL(P("following_ap_ratio"), AP()));
  addFormula(f("initial_explosion_magic_damage", "首次爆炸魔法伤害", first, "InitialExplosionDamage=首次基础值+0.55×来源总法强。", 10));
  addFormula(f("following_explosion_magic_damage", "后续单次爆炸魔法伤害", later, "TotalExplosionDamage=后续基础值+0.05×来源总法强。", 20));
  addFormula(f("all_explosion_magic_damage", "同一敌人多段爆炸魔法总伤害", ADD(first, MUL(SUB(P("explosion_count"), P("unit_count")), later)), "AllDamageHit=首次+(数量−1)×后续；仅当前敌人。", 30));
}, [{ item: "兵野修正、FirstExplosionDelay空值", reason: "兵野专用或无数值不补零。" }], [{ item: "引导与多段命中时点", reason: "0.5秒窗口、首次/后续和总式已录，施法根字段冲突与事件待核。" }], "同一敌人的首次、后续和总式均保留。");
define("Mel", "W", "灵魂折镜", 5, (add, addFormula) => {
  add(fixed("shield_duration_ms", "自身护盾持续（毫秒）", "INTEGER", toMs(dataAt("Mel", "W", "Duration")), "正文消费0.75秒。", 10));
  add(skill("shield_base", "自身护盾基础值", "INTEGER", levels("Mel", "W", "BaseShieldAmount", 5), "索引1至5为80/110/140/170/200。", 20));
  add(fixed("shield_ap_ratio", "自身护盾法强倍率", "DECIMAL", coefficient("Mel", "W", "ShieldAmount", 1), "系数0.7，读取来源总法强。", 30));
  add(fixed("move_speed_percent_points", "自身移动速度百分数点", "DECIMAL", pp(dataAt("Mel", "W", "MoveSpeed")), "正文使用MoveSpeed*100%，为40百分数点。", 40));
  add(fixed("move_speed_duration_ms", "移动速度衰减持续（毫秒）", "INTEGER", toMs(dataAt("Mel", "W", "MoveSpeedDuration")), "正文消费0.75秒。", 50));
  add(skill("reflected_damage_ratio", "反射原伤害比例", "DECIMAL", levels("Mel", "W", "BaseDamagePercent", 5), "DamagePercent为原伤害比例0.4至0.6，正文不再乘0.01。", 60));
  add(fixed("physical_to_magic_reduction_percent_points", "物理转魔法伤害降低百分数点", "DECIMAL", pp(dataAt("Mel", "W", "PhysDamageMod")), "正文使用PhysDamageMod*100%，为30百分数点。", 70));
  add(runtime("actual_reflected_source_damage", "原施法者调整前单次伤害", "DECIMAL", "反射需要原施法者在伤害调整和法术穿透前的实际伤害，不设默认。", 80));
  addFormula(f("self_shield_amount", "灵魂折镜自身护盾", ADD(P("shield_base"), MUL(P("shield_ap_ratio"), AP())), "ShieldAmount=基础护盾+0.7×来源总法强。", 10));
  addFormula(f("reflected_magic_damage", "反射弹体魔法伤害", MUL(P("reflected_damage_ratio"), P("actual_reflected_source_damage")), "DamagePercent×原施法者调整前实际伤害；白名单和免疫资格待接线。", 20));
}, [{ item: "范围内逐敌弹体摧毁", reason: "纯多目标分配不生成额外敌人效果。" }], [{ item: "弹体白名单、免疫和阶段", reason: "真实对方技能输入待接线，不造万能反射或无敌。" }], "反射比例与对方伤害基准分开。");
define("Mel", "E", "阳炎涡旋", 5, (add, addFormula) => {
  add(skill("center_base_damage", "中心基础魔法伤害", "INTEGER", levels("Mel", "E", "BaseDamage", 5), "索引1至5为60/105/150/195/240。", 10));
  add(fixed("center_ap_ratio", "中心法强倍率", "DECIMAL", coefficient("Mel", "E", "Damage", 1), "系数0.7，读取来源总法强。", 20));
  add(fixed("root_duration_ms", "中心禁锢持续（毫秒）", "INTEGER", toMs(dataAt("Mel", "E", "RootDuration")), "正文消费1.5秒。", 30));
  add(skill("area_damage_base_per_second", "区域每秒基础魔法伤害", "INTEGER", levels("Mel", "E", "BaseAreaDamage", 5), "索引1至5为16/28/40/52/64。", 40));
  add(fixed("area_ap_ratio", "区域每秒法强倍率", "DECIMAL", dataAt("Mel", "E", "AreaAPRatio"), "读取来源总法强。", 50));
  add(fixed("area_slow_percent_points", "区域减速百分数点", "DECIMAL", pp(dataAt("Mel", "E", "AreaSlowAmount")), "正文使用*100%，为30百分数点。", 60));
  add(fixed("area_slow_duration_ms", "区域减速离场残留（毫秒）", "INTEGER", toMs(dataAt("Mel", "E", "AreaSlowDuration")), "当前根0.25秒。", 70));
  add(fixed("area_dot_duration_ms", "区域伤害离场残留（毫秒）", "INTEGER", toMs(dataAt("Mel", "E", "DoTDuration")), "当前根0.5秒。", 80));
  add(fixed("area_ticks_per_second", "区域每秒原始跳数", "INTEGER", dataAt("Mel", "E", "AreaTicksPerSecond"), "当前根8；不把每秒值乘8。", 90));
  add(fixed("max_area_radius", "区域最终半径", "INTEGER", dataAt("Mel", "E", "MaxAreaRadius"), "当前根230。", 100));
  add(fixed("area_expand_duration_ms", "区域扩大到最终半径时间（毫秒）", "INTEGER", toMs(dataAt("Mel", "E", "TimeToMaxRadius")), "当前根0.5秒。", 110));
  addFormula(f("center_magic_damage", "中心对敌魔法伤害", ADD(P("center_base_damage"), MUL(P("center_ap_ratio"), AP())), "Damage=基础值+0.7×来源总法强。", 10));
  addFormula(f("area_damage_per_second", "区域对敌每秒魔法伤害", ADD(P("area_damage_base_per_second"), MUL(P("area_ap_ratio"), AP())), "AreaDamagePerSecond=基础值+0.08×来源总法强；8跳是时序证据。", 20));
}, [{ item: "MinionModTooltip=50%", reason: "小兵专用。" }], [{ item: "8跳与每秒/离场残留关系", reason: "只保存每秒式、8跳和残留边界，事件待核。" }], "中心和区域对当前敌人的两段伤害均保留。");
define("Mel", "R", "鎏金蚀日", 3, (add, addFormula) => {
  add(skill("passive_flat_base", "夺命残影基础魔法伤害", "INTEGER", levels("Mel", "R", "BasePassiveFlatDamage", 3), "R等级1至3为60/70/80；未学习R索引0=50已在P单独保存。", 10));
  add(skill("passive_stack_base", "夺命残影每层基础魔法伤害", "INTEGER", levels("Mel", "R", "BasePassiveStackDamage", 3), "R等级1至3为3/4/5；未学习R索引0=2已在P保存。", 20));
  add(fixed("passive_flat_ap_ratio", "夺命残影基础法强倍率", "DECIMAL", coefficient("Mel", "R", "PassiveFlatDamage", 1), "系数0.1，读取来源总法强。", 30));
  add(fixed("passive_stack_ap_ratio", "夺命残影每层法强倍率", "DECIMAL", coefficient("Mel", "R", "PassiveStackDamage", 1), "系数0.0075，读取来源总法强。", 40));
  add(skill("ult_flat_base", "鎏金蚀日基础魔法伤害", "INTEGER", levels("Mel", "R", "BaseUltFlatDamage", 3), "索引1至3为125/200/275。", 50));
  add(skill("ult_stack_base", "鎏金蚀日每层基础魔法伤害", "INTEGER", levels("Mel", "R", "BaseUltStackDamage", 3), "索引1至3为4/7/10。", 60));
  add(fixed("ult_flat_ap_ratio", "鎏金蚀日基础法强倍率", "DECIMAL", coefficient("Mel", "R", "UltFlatDamage", 1), "系数0.3，读取来源总法强。", 70));
  add(fixed("ult_stack_ap_ratio", "鎏金蚀日每层法强倍率", "DECIMAL", coefficient("Mel", "R", "UltStackDamage", 1), "系数0.04，读取来源总法强。", 80));
  add(fixed("disintegrate_delay_ms", "能量命中延迟（毫秒）", "INTEGER", toMs(dataAt("Mel", "R", "DisintegrateDelay")), "当前根0.9秒，不与施法时间混同。", 90));
  addFormula(f("passive_flat_damage", "夺命残影基础魔法伤害公式", ADD(P("passive_flat_base"), MUL(P("passive_flat_ap_ratio"), AP())), "PassiveFlatDamage=基础值+0.1×来源总法强。", 10));
  addFormula(f("passive_stack_damage", "夺命残影每层魔法伤害公式", ADD(P("passive_stack_base"), MUL(P("passive_stack_ap_ratio"), AP())), "PassiveStackDamage=基础值+0.0075×来源总法强。", 20));
  addFormula(f("ult_flat_damage", "鎏金蚀日基础魔法伤害公式", ADD(P("ult_flat_base"), MUL(P("ult_flat_ap_ratio"), AP())), "UltFlatDamage=基础值+0.3×来源总法强。", 30));
  addFormula(f("ult_stack_damage", "鎏金蚀日每层魔法伤害公式", ADD(P("ult_stack_base"), MUL(P("ult_stack_ap_ratio"), AP())), "UltStackDamage=基础值+0.04×来源总法强。", 40));
}, [{ item: "MinionMod及额外带层敌人", reason: "小兵专用或额外敌人分配。" }], [{ item: "至少一名敌方英雄有层的资格和处决比较", reason: "正文条件保留，不伪造触发或即时伤害。" }], "保留四棵当前消费计算树。");

define("Yunara", "P", "初生之誓", 1, (add, addFormula) => {
  add(fixed("critical_extra_damage_base_ratio", "暴击额外魔伤基础倍率", "DECIMAL", part("Yunara", "P", "Calc_Damage_Amp", 0).mNumber, "原树基础0.1比例，暴击基准另行输入。", 10));
  add(fixed("critical_extra_damage_ap_ratio", "暴击额外魔伤法强倍率", "DECIMAL", coefficient("Yunara", "P", "Calc_Damage_Amp", 1), "原树系数0.001，读取来源总法强。", 20));
  add(runtime("actual_critical_damage_base", "当前暴击伤害基准", "DECIMAL", "暴击原始基准与额外魔伤比例独立，不把普攻总攻击力冒充基准，不设默认。", 30));
  addFormula(f("critical_extra_damage_ratio", "暴击额外魔伤倍率", ADD(P("critical_extra_damage_base_ratio"), MUL(P("critical_extra_damage_ap_ratio"), AP())), "Calc_Damage_Amp=0.1+0.001×来源总法强。", 10));
  addFormula(f("critical_extra_magic_damage", "暴击额外魔伤", MUL(P("critical_extra_damage_ratio"), P("actual_critical_damage_base")), "额外比例×独立暴击基准；事件待接线。", 20));
}, [], [{ item: "暴击触发和基准阶段", reason: "比例与独立基准已录，事件待接线。" }], "不使用总攻击力冒充暴击基准。");
define("Yunara", "Q", "灵蕴拳", 5, (add, addFormula) => {
  add(fixed("resource_max", "灵蕴上限", "INTEGER", dataAt("Yunara", "Q", "Resource_Max"), "当前正文8层。", 10));
  add(fixed("resource_champion_gain", "命中英雄获得灵蕴", "INTEGER", dataAt("Yunara", "Q", "Resource_Champion"), "当前一对一攻击英雄获得2层。", 20));
  add(fixed("resource_duration_ms", "灵蕴持续（毫秒）", "INTEGER", toMs(dataAt("Yunara", "Q", "Resource_Duration")), "当前正文6秒。", 30));
  add(fixed("resource_loss_interval_ms", "停止攻击后的灵蕴损失间隔（毫秒）", "INTEGER", toMs(dataAt("Yunara", "Q", "Resource_Loss_Interval")), "当前正文0.5秒。", 40));
  add(fixed("resource_loss_amount", "每次损失灵蕴层数", "INTEGER", dataAt("Yunara", "Q", "Resource_Loss"), "当前正文1层。", 50));
  add(fixed("active_resource_cost", "主动消耗灵蕴层数", "INTEGER", dataAt("Yunara", "Q", "Resource_Max"), "当前正文消耗8层。", 60));
  add(fixed("active_buff_duration_ms", "主动强化持续（毫秒）", "INTEGER", toMs(dataAt("Yunara", "Q", "Buff_Duration")), "当前正文5秒；超凡分支另属R链。", 70));
  add(skill("passive_base_damage", "普攻被动附伤基础魔法伤害", "INTEGER", levels("Yunara", "Q", "Damage_Passive", 5), "索引1至5为5/10/15/20/25。", 80));
  add(skill("active_base_damage", "主动强化附伤基础魔法伤害", "INTEGER", levels("Yunara", "Q", "Damage", 5), "索引1至5为5/10/15/20/25。", 90));
  add(fixed("passive_ap_ratio", "普攻被动附伤法强倍率", "DECIMAL", coefficient("Yunara", "Q", "Calc_Passive_Damage", 1), "系数0.2，读取来源总法强。", 100));
  add(fixed("active_ap_ratio", "主动强化附伤法强倍率", "DECIMAL", coefficient("Yunara", "Q", "Calc_Damage", 1), "系数0.2，读取来源总法强。", 110));
  add(skill("attack_speed_percent_points", "主动强化攻击速度百分数点", "DECIMAL", levels("Yunara", "Q", "Attack_Speed", 5, pp), "索引1至5为20/30/40/50/60百分数点。", 120));
  addFormula(f("passive_magic_damage", "普攻被动附加魔法伤害", ADD(P("passive_base_damage"), MUL(P("passive_ap_ratio"), AP())), "基础值+0.2×来源总法强。", 10));
  addFormula(f("active_magic_damage", "主动强化附加魔法伤害", ADD(P("active_base_damage"), MUL(P("active_ap_ratio"), AP())), "基础值+0.2×来源总法强。", 20));
}, [{ item: "非英雄资源、Calc_Damage_Spread和小兵处决", reason: "非英雄或额外敌人/兵线分支。" }], [{ item: "灵蕴叠加、主动消耗和超凡即刻激活", reason: "自身强化保留，状态与跨技能R事件待接线。" }], "保留普攻被动、主动附伤、资源和攻速，不把传播伤害乘入当前敌人。");
define("Yunara", "W", "善恶轮", 5, (add, addFormula) => {
  add(skill("initial_base_damage", "念珠首段基础魔法伤害", "INTEGER", levels("Yunara", "W", "Damage", 5), "索引1至5为55/95/135/175/215。", 10));
  add(fixed("bonus_ad_ratio", "额外攻击力倍率", "DECIMAL", dataAt("Yunara", "W", "ADRatio"), "Calc_Damage_Initial的mStat=2/formula2，读取来源额外攻击力。", 20));
  add(fixed("ap_ratio", "法强倍率", "DECIMAL", dataAt("Yunara", "W", "APRatio"), "读取来源总法强。", 30));
  add(fixed("dps_modifier", "每秒伤害倍率", "DECIMAL", dataAt("Yunara", "W", "DPS_Modifier"), "Calc_Damage_Per_Second的mMultiplier=0.6。", 40));
  add(fixed("slow_percent_points", "念珠减速百分数点", "DECIMAL", pp(dataAt("Yunara", "W", "Slow_Amount")), "原始0.99，正文显示99百分数点。", 50));
  add(fixed("slow_duration_ms", "念珠减速持续（毫秒）", "INTEGER", toMs(dataAt("Yunara", "W", "Slow_Duration")), "正文消费1.5秒。", 60));
  add(fixed("linger_duration_ms", "念珠终点残留（毫秒）", "INTEGER", toMs(dataAt("Yunara", "W", "Linger_Duration")), "终点残留1秒，不当作额外敌人减速。", 70));
  add(fixed("cast_time_base_ms", "普通念珠施法时间上界（毫秒）", "INTEGER", toMs(dataAt("Yunara", "W", "Cast_Time_Base")), "当前根0.45秒，受永久攻击速度影响。", 80));
  add(fixed("cast_time_min_ms", "普通念珠施法时间下界（毫秒）", "INTEGER", toMs(dataAt("Yunara", "W", "Cast_Time_Min")), "当前根0.225秒边界。", 90));
  add(fixed("cast_time_attack_speed_cap_percent_points", "施法缩放攻击速度上限百分数点", "INTEGER", dataAt("Yunara", "W", "Cast_Time_Attack_Speed_Cap"), "当前根上限100百分数点，中间曲线未证。", 100));
  const initial = ADD(ADD(P("initial_base_damage"), MUL(P("bonus_ad_ratio"), bonusAD())), MUL(P("ap_ratio"), AP()));
  addFormula(f("initial_magic_damage", "念珠首段魔法伤害", initial, "基础值+0.85×来源额外攻击力+0.5×来源总法强。", 10));
  addFormula(f("damage_per_second", "念珠每秒魔法伤害", MUL(P("dps_modifier"), initial), "0.6×完整首段伤害，不重复造每跳伤害。", 20));
}, [{ item: "超凡射线、兵线匿名树", reason: "R完整变形或兵线分支。" }], [{ item: "永久攻速施法曲线和终点残留时点", reason: "只录0.45至0.225秒边界与1秒残留。" }], "不另开W2槽，常态念珠式保持完整。");
define("Yunara", "E", "明踪步", 5, (add, addFormula) => {
  add(skill("move_speed_percent_points", "自身移动速度百分数点", "DECIMAL", levels("Yunara", "E", "Move_Speed", 5, pp), "索引1至5为30/35/40/45/50百分数点。", 10));
  add(fixed("enemy_directed_move_speed_multiplier", "朝敌方英雄移动速度倍率", "DECIMAL", dataAt("Yunara", "E", "Move_Speed_Modifier"), "Calc_Move_Speed_Enhanced的mMultiplier=1.5。", 20));
  add(fixed("buff_duration_ms", "移动速度和幽灵状态持续（毫秒）", "INTEGER", toMs(dataAt("Yunara", "E", "Buff_Duration")), "正文消费1.5秒。", 30));
  addFormula(f("enemy_directed_move_speed", "朝敌方英雄增强移动速度比例", MUL(P("enemy_directed_move_speed_multiplier"), P("move_speed_percent_points")), "常态移动速度比例×1.5；幽灵状态具体免疫范围待接线。", 10));
}, [{ item: "超凡冲刺与ARAM", reason: "完整变形或模式专用。" }], [{ item: "幽灵状态语义", reason: "保留状态，具体碰撞/免疫待核。" }], "只录常态自身速度与朝唯一敌方增强倍率。");
define("Yunara", "R", "定圣诀", 3, () => {}, [{ item: "15秒超凡形态及W/E/Q完整强化链", reason: "按根决策跳过完整变形技能组，原始数值留在来源摘要。" }], [{ item: "超凡跨技能引用", reason: "Q/W/E正文引用和根计算树保留，系统状态接线待后续处理。" }], "R只保留根绑定、正文和原始树，不生成首轮可写组成。");

const order = ["qiyana_p", "qiyana_q", "qiyana_w", "qiyana_e", "qiyana_r", "ksante_p", "ksante_q", "ksante_w", "ksante_e", "ksante_r", "mel_p", "mel_q", "mel_w", "mel_e", "mel_r", "yunara_p", "yunara_q", "yunara_w", "yunara_e", "yunara_r"];
for (const key of order) {
  const write = defs[key].write;
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "OPERATION" && (!Array.isArray(node.operands) || node.operands.length !== 2)) throw new Error("公式非二元 " + key);
    if (Array.isArray(node.operands)) node.operands.forEach(visit);
  };
  for (const item of write.formulas) visit(item.expression);
  for (const item of write.parameters) {
    const values = item.valueMode === "FIXED" ? [item.fixedValue] : Object.values(item.levelValues || {});
    if (item.valueType === "INTEGER" && values.some(x => x !== null && (!Number.isInteger(x) || x < 0))) throw new Error("INTEGER不合规 " + key + "/" + item.parameterKey);
    if (item.parameterKey.endsWith("_ms") && values.some(x => x !== null && (!Number.isInteger(x) || x < 0))) throw new Error("毫秒不合规 " + key + "/" + item.parameterKey);
  }
}
const reusedPublicParameters = reuseList.map(item => {
  const route = "/skills/" + item.skillKey + "/parameters/" + item.parameterKey;
  const hit = protection.requests.find(x => x.route === route);
  if (!hit) throw new Error("复用保护缺失 " + route);
  return { skillKey: item.skillKey, parameterKey: item.parameterKey, source: "输入包/参考资料/公共参数复用清单.json", post: false, detailRoute: route, expected: clone(hit.data), expectedSha256: sha256(JSON.stringify(hit.data)) };
});
const sourceFiles = inputVersion.sourceFiles.map(item => {
  const file = path.join(INPUT, item.path.replaceAll("/", path.sep));
  return { path: "hero42-root-entry-20260910/" + item.path, role: item.role, sha256: shaFile(file), byteSize: fs.statSync(file).size };
});
for (const [relative, file, role] of [["来源绑定与当前文本.json", bindingFile, "当前绑定与原始对象索引"], ["输入版本.json", versionFile, "输入版本"], ["主负责人范围与核对要求.md", rangeFile, "范围要求"], ["主负责人源值核对说明.md", sourceAuditFile, "主负责人源值补核"], ["README.md", inputReadmeFile, "输入说明"]]) sourceFiles.push({ path: "hero42-root-entry-20260910/" + relative, role, sha256: shaFile(file), byteSize: fs.statSync(file).size });
sourceFiles.push({ path: "hero42-cursor-review-run-20260910/Cursor来源复核结论.md", role: "Cursor来源复核结论", sha256: shaFile(cursorConclusionFile), byteSize: fs.statSync(cursorConclusionFile).size });
sourceFiles.push({ path: "hero42-cursor-review-run-20260910/主负责人执行审计.json", role: "Cursor执行审计元数据", sha256: shaFile(cursorAuditFile), byteSize: fs.statSync(cursorAuditFile).size });
const hashes = {
  sourceBindingSha256: shaFile(bindingFile), sourceRangeSha256: shaFile(rangeFile), sourceAuditSha256: shaFile(sourceAuditFile),
  cursorConclusionSha256: shaFile(cursorConclusionFile), cursorAuditSha256: shaFile(cursorAuditFile), protectionSnapshotSha256: shaFile(protectionFile),
  publicReuseSha256: shaFile(reuseFile), inputVersionSha256: shaFile(versionFile), attributeNarrowSha256: shaFile(attributeFile), payloadSampleSha256: shaFile(payloadFile)
};
const candidate = {
  meta: {
    generatedAt: new Date().toISOString(), batch: BATCH, revision: REVISION, status: "候选已生成，等待主负责人审查；未调用业务接口",
    gameId: "lol", apiBase: API_BASE, sourceVersion: { clientVersion: binding.clientVersion, officialVersion: binding.officialVersion, build: heroes.Qiyana.source.client.contentVersion },
    sourcePolicy: "固定客户端16.17、官方16.17.1、当前绑定正文和原始计算树；明确值入候选，未知属性、曲线、事件、跨技能资格和目标阶段无默认。",
    scope: "奇亚娜、奎桑提、梅尔、芸阿娜20个技能槽；唯一敌方英雄一对一。保留普通阶段、自身收益、同敌重复命中和明确跨技能消费；奎桑提全盛完整替换链及芸阿娜超凡完整技能组跳过。",
    ...hashes, currentGETs: inputVersion.GETs, apiCalls: 0, businessWrites: 0, noBusinessWrites: true, tokenStored: false, candidateSha256: null,
    sourceReview: { conclusionFile: ".agents/artifacts/hero42-cursor-review-run-20260910/Cursor来源复核结论.md", auditFile: ".agents/artifacts/hero42-cursor-review-run-20260910/主负责人执行审计.json", verdict: "READY", apiWrites: 0, note: "主负责人源值核对说明晚于Cursor复核，仅作为补充约束，不宣称由Cursor审查。" },
    inputPackage: ".agents/artifacts/hero42-root-entry-20260910"
  },
  skills: Object.fromEntries(order.map(key => [key, defs[key]])), order, reusedPublicParameters, reusedExistingParameters: clone(reusedPublicParameters),
  counts: { newParameters: 0, newFormulas: 0, newEffects: 0, newProcesses: 0, newInternalStates: 0, newTriggerRules: 0, newTotal: 0, reusedPublicParameters: reusedPublicParameters.length, plannedTotalIncludingReused: 0, protectedCurrentCompositionLists: protection.requests.filter(x => /\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(x.route)).length },
  apiWrites: 0, sourceFiles,
  sourceNotes: { fixedClient: "参考资料/客户端原文/*.json.gz，16.17完整对象", fixedOfficial: "参考资料/官方中文与官方英文，16.17.1", currentText: "来源绑定与当前文本.json的mLocKeys绑定正文", attributes: "属性默认与边界.json只用于窄映射，未知阶段保持运行输入", payload: "接口载荷样例.json只作结构参考，不复制数值" },
  protectedObjects: { snapshot: "输入包/参考资料/当前20槽保护快照.json", snapshotSha256: hashes.protectionSnapshotSha256, requestCount: protection.requests.length, routes: protectedRouteHashes, note: "属性、角色、关系、主体、图片和120条六类列表只读；31项公共参数只复用。" },
  revision: REVISION
};
for (const key of order) for (const kind of Object.keys(defs[key].write)) candidate.counts[({ parameters: "newParameters", formulas: "newFormulas", effects: "newEffects", processes: "newProcesses", internalStates: "newInternalStates", triggerRules: "newTriggerRules" })[kind]] += defs[key].write[kind].length;
candidate.counts.newTotal = candidate.counts.newParameters + candidate.counts.newFormulas + candidate.counts.newEffects + candidate.counts.newProcesses + candidate.counts.newInternalStates + candidate.counts.newTriggerRules;
candidate.counts.plannedTotalIncludingReused = candidate.counts.newTotal + candidate.counts.reusedPublicParameters;
const candidateBytes = jsonBytes(candidate);
const candidateSha256 = sha256(candidateBytes);
const range = {
  generatedAt: candidate.meta.generatedAt, batch: BATCH, revision: REVISION, status: "第42批范围与来源选择；未调用业务接口",
  sourceBindingSha256: hashes.sourceBindingSha256, sourceRangeSha256: hashes.sourceRangeSha256, sourceAuditSha256: hashes.sourceAuditSha256,
  cursorConclusionSha256: hashes.cursorConclusionSha256, sourceReviewVerdict: "READY",
  scopeDecisions: { ksante: "普通形态与R变形前两段保留，全盛替换链跳过", yunara: "常态P/Q/W/E保留，R完整超凡组跳过", mel: "P保留未学R时R索引0的50/2跨技能消费", qiyana: "保留元素互斥、同敌重复和重置资格，排除额外敌人及兵野专用" },
  skills: Object.fromEntries(order.map(key => [key, { recordableParameters: defs[key].write.parameters.map(x => x.parameterKey), recordableFormulas: defs[key].write.formulas.map(x => x.formulaKey), excluded: clone(defs[key].excluded), pending: clone(defs[key].pending), currentSubjectProtected: defs[key].protectedExisting.subject }])),
  noApiCalls: true, apiWrites: 0
};
const rangeBytes = jsonBytes(range);
const rangeSha256 = sha256(rangeBytes);
const requests = [];
for (const key of order) for (const [kind, id, api] of [["parameters", "parameterKey", "parameters"], ["formulas", "formulaKey", "formulas"], ["effects", "effectKey", "effects"], ["processes", "processKey", "processes"], ["internalStates", "stateKey", "internal-states"], ["triggerRules", "ruleKey", "trigger-rules"]]) for (const body of defs[key].write[kind]) requests.push({ sequence: requests.length + 1, operation: "POST", method: "POST", route: "/skills/" + key + "/" + api, detailRoute: "/skills/" + key + "/" + api + "/" + body[id], skillKey: key, kind, stableKey: body[id], status: "仅意图，未调用", body: clone(body) });
if (requests.length !== candidate.counts.newTotal) throw new Error("请求数量不符");
const plan = { generatedAt: candidate.meta.generatedAt, status: "仅写入意图，未调用业务接口", batch: BATCH, revision: REVISION, apiBase: API_BASE, sourceVersion: clone(candidate.meta.sourceVersion), candidateSha256, sourceBindingSha256: hashes.sourceBindingSha256, sourceRangeSha256: rangeSha256, sourceAuditSha256: hashes.sourceAuditSha256, protectionSnapshotSha256: hashes.protectionSnapshotSha256, publicReuseSha256: hashes.publicReuseSha256, requestCount: requests.length, counts: clone(candidate.counts), reusedPublicParameters: clone(reusedPublicParameters), protectedRoutes: protectedRouteHashes, protectedSummary: { inputGETs: protection.GETs, inputRequestCount: protection.requests.length, note: "写入前逐条GET保护；本计划不覆盖已有组成。" }, requests, noApiCalls: true, apiWrites: 0, businessWrites: 0 };
const planBytes = jsonBytes(plan);
const planSha256 = sha256(planBytes);
const sourceValues = { generatedAt: candidate.meta.generatedAt, batch: BATCH, revision: REVISION, status: "独立来源值摘要；未调用业务接口", sourceBindingSha256: hashes.sourceBindingSha256, sourceAuditSha256: hashes.sourceAuditSha256, sourceValues: Object.fromEntries(order.map(key => { const s = defs[key].source; return [key, { hero: s.hero, slot: s.slot, currentText: clone(s.currentBoundText), rawDataValues: clone(s.raw.dataValues), rawCalculations: clone(s.raw.calculations), selectedParameterKeys: defs[key].write.parameters.map(x => x.parameterKey), selectedFormulaKeys: defs[key].write.formulas.map(x => x.formulaKey), sourceTextConsumers: Object.values(s.currentBoundText || {}).map(x => x?.text || "").join("\n") }]; })), excludedSourceNames: { qiyana_p: ["ICD", "BurnDuration", "HealDuration", "HealRadius", "{222614ec}"], qiyana_q: ["FalloffDamage", "JungleDamageAmp", "TremorBonus"], qiyana_w: ["CleaveDamage", "TremorDamage", "TravelDistanceShort"], qiyana_r: ["MonsterCap", "Slow", "RecastWindow"], ksante_p: ["MaxHealthDamagePercent", "{281dd874}", "MinimumMinionDamage", "MaxMonsterDamage"], ksante_q: ["{9c9367bc}", "RCooldownReduction"], ksante_w: ["RDamageIncreaseMin", "RDamageIncreaseMax", "RDamageReduction", "MinimumMinionDamage", "MaxMonsterDamage"], ksante_e: ["AllySpeedBase", "FreeTargetRangeAO", "FreeTargetSpeedAO", "AllySpeedAO"], ksante_r: ["AllOutDuration", "HealthLost", "DefensesLost", "Omnivamp", "AttackSpeed", "ArmorPenPercent"], mel_p: ["小兵残影削减"], mel_q: ["MonsterModTooltip", "FirstExplosionDelay"], mel_w: ["ShieldRadius"], mel_e: ["MinionModTooltip"], mel_r: ["MinionModTooltip"], yunara_q: ["Resource_Nonchampion", "Spread_Radius", "Spread_AD_Ratio", "Spread_Lifesteal_Efficacy", "Spread_Onhit_Efficacy", "Calc_Damage_Spread", "Calc_Minion_Execute_Threshold", "Calc_Minion_Execute_Amp"], yunara_w: ["{669adf33}", "Calc_Minion_Damage_Mod"], yunara_e: ["超凡冲刺"], yunara_r: ["全部超凡强化计算树"] }, noApiCalls: true, apiWrites: 0 };
const sourceValuesBytes = jsonBytes(sourceValues);
const sourceValuesSha256 = sha256(sourceValuesBytes);
const version = { generatedAt: candidate.meta.generatedAt, batch: BATCH, revision: REVISION, status: "候选冻结，待主负责人审查；未调用业务接口", candidateSha256, planSha256, rangeSha256, sourceValuesSha256, ...hashes, counts: clone(candidate.counts), requestCount: requests.length, sourceMath: "独立源值数学.mjs", sourceMathStatus: "待执行", apiCalls: 0, businessWrites: 0, noBusinessWrites: true };
const fileHashes = { candidateSha256, planSha256, rangeSha256, sourceValuesSha256, ...hashes, generatedAt: candidate.meta.generatedAt };
const readme = ["# 第四十二批候选", "", "本目录保存奇亚娜、奎桑提、梅尔、芸阿娜20个技能槽的候选组成。来源固定客户端16.17、官方16.17.1、当前根绑定正文和原始计算树；Cursor来源复核为READY，主负责人源值核对说明晚于Cursor复核，仅作为补充约束。", "", "候选只计划新增组成，输入包31项公共冷却/法力参数只读复用；属性、角色、关系、主体、图片和现有六类组成保护。未调用业务接口。", "", "一对一范围保留自身收益、同敌重复命中和明确跨技能消费；奎桑提全盛完整替换链与芸阿娜超凡完整技能组跳过，但奎桑提R变形前两段保留。梅尔P保存未学习R仍消费的R索引0基础50/每层2。", "", "公式全部保持二元；百分数按当前正文单位处理，未知属性阶段、等级曲线、暴击基准、对方弹体伤害和事件时序无默认。", ""].join("\n");
const experience = ["# 第四十二批候选体验记录", "", "20个技能槽均有根绑定、当前中文正文、官方中文/英文来源和主体保护快照。每个技能先列参数，再列当前敌人可用的混合公式，排除项和待核项各自保留。", "", "主要缺口是事件层：奇亚娜元素重置、奎桑提标记与蓄力阶段、梅尔弹体白名单和R零级跨技能、芸阿娜资源与暴击基准尚未接入；候选未用零值或同名旧树填补。", "", "R范围明确：奎桑提只录变形前两段，芸阿娜R只留来源范围记录。", ""].join("\n");
fs.mkdirSync(ROOT, { recursive: true }); fs.mkdirSync(DURABLE, { recursive: true });
for (const [name, bytes] of [["完整候选.json", candidateBytes], ["请求计划.json", planBytes], ["来源与范围.json", rangeBytes], ["来源值摘要.json", sourceValuesBytes], ["候选版本.json", jsonBytes(version)], ["来源哈希汇总.json", jsonBytes({ generatedAt: candidate.meta.generatedAt, batch: BATCH, revision: REVISION, files: fileHashes, inputFiles: sourceFiles, apiCalls: 0, businessWrites: 0 })], ["README.md", Buffer.from(readme, "utf8")], ["体验报告.md", Buffer.from(experience, "utf8")], ["文件散列.json", jsonBytes(fileHashes)]]) { writeNew(path.join(ROOT, name), bytes); writeNew(path.join(DURABLE, name), bytes); }
writeJsonNew(path.join(ROOT, "来源冻结通知.json"), { batch: BATCH, revision: REVISION, candidateSha256, planSha256, rangeSha256, sourceValuesSha256, counts: candidate.counts, requestCount: requests.length, apiCalls: 0, businessWrites: 0, status: "冻结候选，等待主负责人审查；未调用业务接口" });
console.log(JSON.stringify({ revision: REVISION, candidateSha256, planSha256, rangeSha256, sourceValuesSha256, counts: candidate.counts, requestCount: requests.length, reusedPublicParameters: reusedPublicParameters.length, apiCalls: 0, businessWrites: 0, durable: DURABLE }, null, 2));
