import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "hero39-root-entry-20260910");
const DURABLE = path.resolve("C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十九批");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";
const BATCH = "英雄机制第三十九批";
const REVISION = "hero39-source-v1";

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
const rangeDoc = path.join(INPUT, "主负责人范围与核对要求.md");
const cursorSupplement = path.join(INPUT, "Cursor复核后补充.md");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const payloadFile = path.join(INPUT, "参考资料", "接口载荷样例.json");
const binding = readJson(bindingFile);
const inputVersion = readJson(versionFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const payloadSample = readJson(payloadFile);

const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const sourceSkills = {};
for (const hero of binding.heroes) {
  sourceSkills[hero.id] = Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]));
}
const subjectByRoute = new Map(
  protection.requests
    .filter(request => request.route && request.route.startsWith("/skills/"))
    .map(request => [request.route, request.data])
);
const protectedRouteHashes = protection.requests.map(request => ({
  route: request.route,
  status: request.status,
  dataSha256: sha256(JSON.stringify(request.data)),
}));

const indexSkill = (hero, slot) => {
  const skill = sourceSkills[hero] && sourceSkills[hero][slot];
  if (!skill) throw new Error("缺少源技能 " + hero + "/" + slot);
  return skill;
};
const spell = (hero, slot) => indexSkill(hero, slot).object.mSpell;
const dataRow = (hero, slot, name) => {
  const row = (spell(hero, slot).DataValues || []).find(value => value.name === name);
  if (!row || !Array.isArray(row.values)) throw new Error("缺少DataValue " + hero + "/" + slot + "/" + name);
  return row.values;
};
const dataAt = (hero, slot, name, index = 1) => dataRow(hero, slot, name)[index];
const calc = (hero, slot, name) => {
  const value = (spell(hero, slot).mSpellCalculations || {})[name];
  if (!value) throw new Error("缺少计算树 " + hero + "/" + slot + "/" + name);
  return value;
};
const treePart = (hero, slot, calcName, partIndex = 0) => {
  const parts = calc(hero, slot, calcName).mFormulaParts || [];
  if (!parts[partIndex]) throw new Error("缺少计算树分支 " + hero + "/" + slot + "/" + calcName + "/" + partIndex);
  return parts[partIndex];
};
const levelValues = (values, max, transform = value => value) =>
  Object.fromEntries(Array.from({ length: max }, (_, index) => [String(index + 1), transform(values[index + 1])]));
const fixedLevelValues = (hero, slot, name, max, transform = value => value) =>
  levelValues(dataRow(hero, slot, name), max, transform);
const toMs = seconds => {
  const value = Math.round(seconds * 1000);
  if (!Number.isFinite(value) || Math.abs(value - seconds * 1000) > 1e-3 || value < 0) {
    throw new Error("时间不是非负整数毫秒：" + seconds);
  }
  return value;
};
const percentPoints = value => value * 100;
const charBreakpointValues = part => {
  if (typeof part.mLevel1Value !== "number") throw new Error("角色等级断点缺少mLevel1Value");
  const breakpoints = part.mBreakpoints || [];
  const perLevel = typeof part.mInitialBonusPerLevel === "number" ? part.mInitialBonusPerLevel : 0;
  return Object.fromEntries(Array.from({ length: 18 }, (_, index) => {
    const level = index + 1;
    const value = breakpoints.reduce(
      (total, breakpoint) => level >= breakpoint.mLevel ? total + breakpoint.mAdditionalBonusAtThisLevel : total,
      part.mLevel1Value + perLevel * index
    );
    return [String(level), value];
  }));
};
const charBreakpointPart = (hero, slot, calcName, partIndex = 0) =>
  charBreakpointValues((treePart(hero, slot, calcName, partIndex).mSubpart) || treePart(hero, slot, calcName, partIndex));
const exactArray = values => values.map(value => value);

const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({
  nodeType: "ATTRIBUTE",
  attributeOwner,
  attributeKey,
  attributeValueKind,
});
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);
const SUB = (left, right) => O("SUBTRACT", left, right);
const sourceTotalAD = () => A("SOURCE", "attack_damage", "TOTAL");
const sourceBonusAD = () => A("SOURCE", "attack_damage", "BONUS");
const sourceBonusHP = () => A("SOURCE", "hp", "BONUS");
const sourceAP = () => A("SOURCE", "ability_power", "TOTAL");

const fixed = (parameterKey, name, valueType, fixedValue, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "FIXED", fixedValue, levelValues: null, description, sortOrder,
});
const skillLevel = (parameterKey, name, valueType, values, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "SKILL_LEVEL", fixedValue: null, levelValues: values, description, sortOrder,
});
const characterLevel = (parameterKey, name, valueType, values, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "CHARACTER_LEVEL", fixedValue: null, levelValues: values, description, sortOrder,
});
const runtime = (parameterKey, name, valueType, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode: "RUNTIME_INPUT", fixedValue: null, levelValues: null, description, sortOrder,
});
const formula = (formulaKey, name, expression, description, sortOrder) => ({
  formulaKey, name, expression, description, sortOrder,
});

const officialFor = (heroId, slot, english = false) => {
  const file = path.join(INPUT, "参考资料", english ? "官方英文" : "官方中文", heroId + ".json");
  const root = readJson(file).data[heroId];
  return slot === "P" ? root.passive : root.spells[["Q", "W", "E", "R"].indexOf(slot)];
};
const sourceFor = (heroId, slot) => {
  const hero = heroes[heroId];
  const meta = hero.source.skills.find(skill => skill.slot === slot);
  const rootSkill = indexSkill(heroId, slot);
  const rawSpell = rootSkill.object.mSpell;
  const rawDataValues = Object.fromEntries(
    (rawSpell.DataValues || []).map(row => [row.name, row.values ? exactArray(row.values) : null])
  );
  const raw = {
    dataValues: rawDataValues,
    calculations: clone(rawSpell.mSpellCalculations || {}),
    fields: {
      spellCastTime: rawSpell.spellCastTime ?? null,
      mCastTime: rawSpell.mCastTime ?? null,
      spellTotalTime: rawSpell.spellTotalTime ?? null,
      mChannelDuration: rawSpell.mChannelDuration ?? null,
      cooldownTime: rawSpell.cooldownTime ?? null,
      mana: rawSpell.mana ?? null,
      manaValues: rawSpell.manaValues ?? null,
      mMaxAmmo: rawSpell.mMaxAmmo ?? null,
      mAmmoRechargeTime: rawSpell.mAmmoRechargeTime ?? null,
      mDoesNotConsumeMana: rawSpell.mDoesNotConsumeMana ?? null,
      mDoesNotConsumeCooldown: rawSpell.mDoesNotConsumeCooldown ?? null,
    },
  };
  const clientPath = path.join("参考资料", meta.clientPath || hero.source.client.path);
  return {
    hero: heroId,
    heroName: hero.name,
    heroKey: hero.key,
    slot,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath,
    spellPath: meta.clientPath,
    bindingAvailable: meta.bindingAvailable,
    clientFile: clientPath.replaceAll("\\", "/"),
    clientSha256: shaFile(path.join(INPUT, "参考资料", "客户端原文", heroId + ".json.gz")),
    clientCompressedSha256: hero.source.client.compressedSha256,
    clientBuild: hero.source.client.contentVersion,
    officialZhFile: ("参考资料/官方中文/" + heroId + ".json"),
    officialZhSha256: shaFile(path.join(INPUT, "参考资料", "官方中文", heroId + ".json")),
    officialEnFile: ("参考资料/官方英文/" + heroId + ".json"),
    officialEnSha256: shaFile(path.join(INPUT, "参考资料", "官方英文", heroId + ".json")),
    currentBoundText: clone(rootSkill.currentTexts),
    raw,
    officialEvidence: {
      zh: clone(officialFor(heroId, slot, false)),
      en: clone(officialFor(heroId, slot, true)),
    },
    currentTextPath: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot + "/currentTexts",
  };
};

const definitions = {};
const makeDefinition = (heroId, slot, name, maxLevel, build, excluded, pending, proofNote) => {
  const write = { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  const addParameter = parameter => write.parameters.push(parameter);
  const addFormula = item => write.formulas.push(item);
  build(addParameter, addFormula);
  const skillKey = heroId.toLowerCase() + "_" + slot.toLowerCase();
  const subject = subjectByRoute.get("/skills/" + skillKey) || null;
  definitions[skillKey] = {
    skillKey,
    name: heroes[heroId].name + "·" + name,
    maxLevel,
    source: sourceFor(heroId, slot),
    write,
    protectedExisting: {
      subject: Boolean(subject),
      compositionLists: true,
      protectionSnapshot: "输入包/参考资料/当前20槽保护快照.json",
    },
    excluded,
    pending,
    proofs: [
      { type: "root-bound-source", path: "输入包/来源绑定与当前文本.json -> " + heroId + "/" + slot },
      {
        type: "fixed-source-version",
        client: binding.clientVersion,
        official: binding.officialVersion,
        build: heroes[heroId].source.client.contentVersion,
      },
    ],
    proofNote,
    currentSubject: subject,
  };
};
const currentTextEvidence = skillKey => {
  const value = definitions[skillKey].source.currentBoundText || {};
  return Object.values(value).map(item => item && item.text || "").join("\n");
};

makeDefinition("Urgot", "P", "回响烈焰", 1, (add, addFormula) => {
  const cooldown = charBreakpointPart("Urgot", "P", "PerLegCD");
  const adRatio = charBreakpointPart("Urgot", "P", "ADDamage", 0);
  const hpRatio = charBreakpointPart("Urgot", "P", "PercentHPRatio");
  add(characterLevel("leg_attack_cooldown_ms", "逐腿攻击冷却（毫秒）", "INTEGER",
    Object.fromEntries(Object.entries(cooldown).map(([level, value]) => [level, toMs(value)])),
    "PerLegCD的mPrecision=1和角色等级断点；1级为30秒，6/9/11/13级分别追加-10/-10/-5/-2.5秒，按原树展开18级后转为毫秒。", 10));
  add(characterLevel("leg_attack_ad_ratio", "逐腿总攻击力比例", "DECIMAL", adRatio,
    "ADDamage的mStat=2且未给mStatFormula，按当前窄证读取来源总攻击力；原树断点为1级0.4，6/9/11/13/15级各增加0.12。", 20));
  add(characterLevel("leg_attack_target_max_health_ratio", "逐腿目标最大生命比例", "DECIMAL", hpRatio,
    "PercentHPRatio保留原始比例0.02并按断点增加0.01；mDisplayAsPercent仅影响显示，公式中不再除以100。生命池读取阶段仍由实际输入提供。", 30));
  add(fixed("leg_warning_time_ms", "逐腿预警时间（毫秒）", "INTEGER", toMs(dataAt("Urgot", "P", "LegWarningTime")),
    "当前LegWarningTime=2.5秒，转换为2500毫秒；只记录预警窗口，不创建未经证实的周期触发。", 40));
  add(fixed("leg_count", "可用火焰腿数量", "INTEGER", 6,
    "范围要求保留厄加特六条腿对同一敌人的逐次命中；数量是技能主体事实，不代表事件自动触发。", 50));
  add(runtime("actual_target_max_health", "逐腿命中时目标实际最大生命", "DECIMAL",
    "PercentHPRatio的生命池归属和读取阶段未由当前树单独证明；运行层必须提供实际目标最大生命，不设默认。", 60));
  addFormula(formula("leg_physical_damage", "逐腿单次物理伤害",
    ADD(MUL(P("leg_attack_ad_ratio"), sourceTotalAD()), MUL(P("leg_attack_target_max_health_ratio"), P("actual_target_max_health"))),
    "单次逐腿伤害保留ADDamage与PercentHPRatio两项；总攻击力来源归属依据mStat=2无formula窄证，生命值阶段留给实际输入。", 10));
}, [
  { item: "MonsterCap", reason: "仅野怪上限，不进入唯一敌方英雄范围。" },
  { item: "TriggerRange/CastRange与附近其他敌人恐惧", reason: "范围或额外目标专用分支；不扩大到一对一主体。" },
], [
  { item: "逐腿触发时点和生命读取阶段", reason: "保留六腿、冷却和完整伤害式，攻击命中事件与生命池读取阶段待运行层接线。" },
], "P仅沿UrgotPassive根绑定；六腿同一敌人命中、完整伤害式和等级断点进入候选，兵野/额外目标分支单列排除。");

makeDefinition("Urgot", "Q", "腐蚀电荷", 5, (add, addFormula) => {
  add(skillLevel("base_damage", "腐蚀电荷基础物理伤害", "INTEGER", fixedLevelValues("Urgot", "Q", "BaseDamage", 5),
    "BaseDamage取索引1至5；索引0=-20是占位，不作为1级。", 10));
  add(fixed("ad_ratio", "腐蚀电荷总攻击力比例", "DECIMAL", 0.699999988079071,
    "TotalDamage第二项mStat=2且未给mStatFormula，读取来源总攻击力；比例来自原树StatByCoefficient=0.7。", 20));
  add(fixed("slow_duration_ms", "腐蚀电荷减速持续（毫秒）", "INTEGER", toMs(dataAt("Urgot", "Q", "SlowDuration")),
    "SlowDuration=1.25秒，转换为1250毫秒。", 30));
  add(skillLevel("slow_percent_points", "腐蚀电荷减速百分数点", "DECIMAL", fixedLevelValues("Urgot", "Q", "SlowAmount", 5, percentPoints),
    "SlowAmount技能等级1至5取索引1至5；原始比例乘100后保存为减速百分数点，公式不再次乘或除100。", 40));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Urgot", "Q").spellCastTime),
    "仅存在spellCastTime=0.25秒且mCastTime为空，转换为250毫秒。", 50));
  addFormula(formula("physical_damage", "腐蚀电荷单一敌人物理伤害",
    ADD(P("base_damage"), MUL(P("ad_ratio"), sourceTotalAD())),
    "TotalDamage=BaseDamage+0.7×来源总攻击力；当前一对一只计算主命中，不自动叠加额外爆炸目标。", 10));
}, [
  { item: "额外爆炸目标", reason: "Q的额外爆炸目标不属于本批唯一敌方英雄主命中。" },
], [], "Q只保留同一敌方英雄的主物理伤害与减速；原树等级索引从1开始，未把索引0占位误作技能等级1。");

makeDefinition("Urgot", "W", "净除", 5, (add, addFormula) => {
  add(fixed("attack_frequency_per_second", "净除每秒攻击次数", "DECIMAL", dataAt("Urgot", "W", "WAttacksPerSecond"),
    "WAttacksPerSecond=3；只保存固定射速，不把它自动转成周期过程。", 10));
  add(fixed("base_damage_per_shot", "净除每发基础物理伤害", "INTEGER", dataAt("Urgot", "W", "BaseDamage"),
    "DamagePerShot正文消费BaseDamage=12。", 20));
  add(skillLevel("ad_ratio", "净除每发总攻击力比例", "DECIMAL", fixedLevelValues("Urgot", "W", "ADRatioTT", 5),
    "DamagePerShot的ADRatioTT取索引1至5；mStat=2未给formula，读取来源总攻击力。", 30));
  add(fixed("on_hit_effectiveness_ratio", "净除攻击特效效能比例", "DECIMAL", dataAt("Urgot", "W", "OnHitDamageReduction"),
    "当前正文明确攻击特效效能为50%，保留比例0.5；不创建具体特效触发过程。", 40));
  add(fixed("self_move_speed_reduction_points", "净除自身移动速度减少点数", "INTEGER", dataAt("Urgot", "W", "MoveSpeedMod"),
    "MoveSpeedMod=125是自身移动速度减少点数，不按百分比解释。", 50));
  add(fixed("slow_resist_percent_points", "净除自身减速抗性百分数点", "DECIMAL", dataAt("Urgot", "W", "SlowResistance"),
    "SlowResistance原始值40，按百分数点保存；不改成比例0.4。", 60));
  add(skillLevel("finite_duration_ms", "净除有限持续时间（毫秒）", "INTEGER", { "1": 4000, "2": 4000, "3": 4000, "4": 4000 },
    "Duration技能等级1至4均为4秒，转换为4000毫秒；满级25000是开关占位，单独记录而不写成25000000毫秒。", 70));
  add(fixed("max_rank_toggle_mode", "净除满级开关模式", "INTEGER", 1,
    "Duration满级25000表示可持续开关模式；1表示该模式存在，实际开启和停止时点待运行层接线。", 80));
  add(fixed("cannot_crit", "净除不能暴击", "INTEGER", 1,
    "当前正文明确净除攻击不能暴击；仅保存资格事实，不造暴击过程。", 90));
  add(fixed("mark_duration_ms", "净除英雄标记持续（毫秒）", "INTEGER", 5000,
    "当前正文明确最后一名敌方英雄标记5秒，来自当前文字而非DataValue。", 100));
  add(fixed("recast_lockout_ms", "净除再次施放限制（毫秒）", "INTEGER", 1500,
    "当前正文明确再次施放限制1.5秒；与MoveSpeedDuration=0.5的自身减速窗口分开，原始WHalterDuration=1.5秒转换为1500毫秒。", 110));
  addFormula(formula("damage_per_shot", "净除单发物理伤害",
    ADD(P("base_damage_per_shot"), MUL(P("ad_ratio"), sourceTotalAD())),
    "正文消费tooltipOnly的DamagePerShot；完整式=12+ADRatioTT×来源总攻击力，射击次数和逐腿触发时序另留事件层。", 10));
}, [
  { item: "MinionMinimumDamage", reason: "仅小兵最低伤害修正，不进入一对一英雄请求。" },
  { item: "额外目标与小兵碰撞", reason: "额外敌人或兵线限定分支；当前单敌射击保留。" },
], [
  { item: "开关攻击间隔与逐腿触发", reason: "射速、攻击特效比例和满级开关事实已保存，实际间隔、逐腿触发事件待运行层接线。" },
], "W的DamagePerShot虽标tooltipOnly但当前正文消费；满级25000严格作为开关模式标记，未转换成虚假的毫秒持续。");

makeDefinition("Urgot", "E", "鄙弃", 5, (add, addFormula) => {
  add(skillLevel("shield_base", "鄙弃护盾基础值", "INTEGER", fixedLevelValues("Urgot", "E", "EShieldBaseHealth", 5),
    "EShieldBaseHealth取索引1至5的55/75/95/115/135；索引0=35是占位。", 10));
  add(fixed("shield_bonus_ad_ratio", "鄙弃护盾额外攻击力比例", "DECIMAL", dataAt("Urgot", "E", "EShieldbADRatio"),
    "ETotalShieldHealth的mStat=2、mStatFormula=2，读取来源额外攻击力；索引1起固定1.35，索引0=1.5不采用。", 20));
  add(fixed("shield_bonus_health_ratio", "鄙弃护盾来源额外生命比例", "DECIMAL", dataAt("Urgot", "E", "EShieldBonusHealthRatio"),
    "ETotalShieldHealth的mStat=12、mStatFormula=2，依据当前窄证读取来源额外生命；索引1起为0.135。", 30));
  add(fixed("shield_duration_ms", "鄙弃护盾持续（毫秒）", "INTEGER", toMs(dataAt("Urgot", "E", "EShieldDuration")),
    "EShieldDuration=4秒，转换为4000毫秒。", 40));
  add(skillLevel("damage_base", "鄙弃冲撞基础物理伤害", "INTEGER", fixedLevelValues("Urgot", "E", "EBaseDamage", 5),
    "EBaseDamage取索引1至5的90/120/150/180/210；索引0=60是占位。", 50));
  add(fixed("damage_bonus_ad_ratio", "鄙弃冲撞额外攻击力比例", "DECIMAL", 1,
    "EDamage的mStat=2、mStatFormula=2且mCoefficient=1，读取来源额外攻击力。", 60));
  add(fixed("stun_duration_ms", "鄙弃晕眩持续（毫秒）", "INTEGER", toMs(dataAt("Urgot", "E", "StunDuration")),
    "StunDuration=1.5秒，转换为1500毫秒。", 70));
  addFormula(formula("shield_value", "鄙弃护盾值",
    ADD(ADD(P("shield_base"), MUL(P("shield_bonus_ad_ratio"), sourceBonusAD())), MUL(P("shield_bonus_health_ratio"), sourceBonusHP())),
    "ETotalShieldHealth=基础值+1.35×来源额外攻击力+0.135×来源额外生命；护盾应用资格和时点不在本轮创建效果。", 10));
  addFormula(formula("physical_damage", "鄙弃冲撞单一敌人物理伤害",
    ADD(P("damage_base"), MUL(P("damage_bonus_ad_ratio"), sourceBonusAD())),
    "EDamage=基础伤害+1×来源额外攻击力；保留当前单敌冲撞主命中。", 20));
}, [
  { item: "额外碰撞目标与践踏非英雄", reason: "只保留当前一对一冲撞主体；额外目标和兵野分支不写入。" },
], [
  { item: "施法时间", reason: "spellCastTime=0与mCastTime=0.45秒冲突，不选零值或另一字段作为当前施法时间。" },
  { item: "护盾与晕眩应用时点", reason: "数值和持续时间已保留，命中资格、效果时序待运行层接线。" },
], "E严格按索引1起读取护盾和伤害，mStat2/2与mStat12/2分别保留额外攻击力和来源额外生命；冲突施法时间不入候选。");

makeDefinition("Urgot", "R", "超越死亡的恐惧", 3, (add, addFormula) => {
  add(skillLevel("damage_base", "超越死亡基础物理伤害", "INTEGER", fixedLevelValues("Urgot", "R", "RBaseDamage", 3),
    "RBaseDamage取索引1至3的100/225/350。", 10));
  add(fixed("damage_bonus_ad_ratio", "超越死亡额外攻击力比例", "DECIMAL", dataAt("Urgot", "R", "RBonusADRatio"),
    "RCalculatedDamage的mStat=2、mStatFormula=2，读取来源额外攻击力。", 20));
  add(fixed("execute_health_threshold_percent_points", "超越死亡处决生命阈值百分数点", "DECIMAL", dataAt("Urgot", "R", "RHealthThreshold"),
    "正文和RHealthThreshold均为25%，按百分数点保存；资格判断由运行层读取当前目标生命。", 30));
  add(fixed("slow_duration_ms", "超越死亡减速持续（毫秒）", "INTEGER", toMs(dataAt("Urgot", "R", "RSlowDuration")),
    "RSlowDuration=4秒，转换为4000毫秒。", 40));
  add(fixed("slow_per_missing_health_percent_points", "超越死亡每百分之一已损生命减速增量", "DECIMAL", dataAt("Urgot", "R", "RSlowMultiplier"),
    "正文明确每1%已损生命增加1%减速；RSlowMultiplier=1按百分数点保存。", 50));
  add(fixed("max_slow_percent_points", "超越死亡最大减速百分数点", "DECIMAL", dataAt("Urgot", "R", "RMoveSpeedMod"),
    "RMoveSpeedMod=75是减速上限百分数点，不把75解释为移动速度倍率。", 60));
  addFormula(formula("physical_damage", "超越死亡单一敌人物理伤害",
    ADD(P("damage_base"), MUL(P("damage_bonus_ad_ratio"), sourceBonusAD())),
    "RCalculatedDamage=基础伤害+0.5×来源额外攻击力；只保留当前被命中敌方英雄的伤害。", 10));
}, [
  { item: "附近敌人的恐惧与恐惧半径", reason: "RFearDuration/RFearRadius只服务附近额外敌人，本批唯一敌方英雄不写入。" },
], [
  { item: "施法时间与自动再施放", reason: "spellCastTime=0与mCastTime=0.5秒冲突；自动处决再施放时点也未由当前树证明。" },
], "R保留当前敌方英雄处决资格、主伤害和减速参数；附近恐惧与施法时间冲突分别列为范围外和待核。");

makeDefinition("Samira", "P", "悍勇本色", 1, (add, addFormula) => {
  add(fixed("style_grade_count", "评价等级总数", "INTEGER", 6,
    "当前正文评价从E到S共6级；等级输入属于战前或战斗状态，不能由公式自动生成。", 10));
  add(fixed("style_decay_duration_ms", "评价衰减持续（毫秒）", "INTEGER", toMs(dataAt("Samira", "P", "DurationTOOLTIP")),
    "DurationTOOLTIP=6秒，转换为6000毫秒。", 20));
  add(characterLevel("queen_max_dash_range_points", "定身目标最大突进距离", "INTEGER",
    charBreakpointPart("Samira", "P", "QueenMaxDashRange"),
    "QueenMaxDashRange由650开始，4/8/12/16级各增加75，按角色等级展开18级。", 30));
  add(characterLevel("style_move_speed_ratio_per_grade", "每评价等级移动速度比例", "DECIMAL",
    charBreakpointPart("Samira", "P", "MSBonusNew"),
    "MSBonusNew每评价等级增加移动速度比例；1级0.0275，6/11/16级各增加0.0025，按角色等级展开。", 40));
  add(fixed("melee_base_damage_level1", "近战额外伤害角色等级起点", "DECIMAL",
    calc("Samira", "P", "BonusMeleeDamage").mFormulaParts[0].mLevel1Value,
    "BonusMeleeDamage的mLevel1Value=2；只保留原树起点。", 50));
  add(fixed("melee_base_damage_per_character_level", "近战额外伤害每角色等级增量", "DECIMAL",
    calc("Samira", "P", "BonusMeleeDamage").mFormulaParts[0].mInitialBonusPerLevel,
    "BonusMeleeDamage的mInitialBonusPerLevel=1；不把它误建成纯技能等级阶梯。", 60));
  add(runtime("melee_base_damage_at_character_level", "近战额外伤害角色等级实际基础值", "DECIMAL",
    "BonusMeleeDamage的角色等级部分实际求值阶段由运行层提供；不以端点或名称猜中间读取方式。", 70));
  add(fixed("melee_ad_ratio_min", "近战额外伤害总攻击力比例下限", "DECIMAL",
    calc("Samira", "P", "BonusMeleeDamage").mFormulaParts[1].mSubpart.mStartValue,
    "BonusMeleeDamage的总攻击力比例角色等级插值下限0.035；中间值不猜。", 80));
  add(fixed("melee_ad_ratio_max", "近战额外伤害总攻击力比例上限", "DECIMAL",
    calc("Samira", "P", "BonusMeleeDamage").mFormulaParts[1].mSubpart.mEndValue,
    "BonusMeleeDamage的总攻击力比例角色等级插值上限0.105；中间值不猜。", 90));
  add(runtime("melee_ad_ratio_at_character_level", "近战额外伤害角色等级实际攻击力比例", "DECIMAL",
    "BonusMeleeDamage的总攻击力比例是角色等级插值；实际等级值由运行层提供，不设默认。", 100));
  add(runtime("actual_style_grade_count", "当前评价等级输入", "INTEGER",
    "移动速度和近战强化均依赖当前E至S评价等级；运行层提供0至6的实际整数，不以触发器代替输入。", 110));
  add(fixed("melee_missing_health_max_multiplier", "近战额外伤害最高倍率", "DECIMAL",
    calc("Samira", "P", "EmpoweredMeleeDamageTooltip").mMultiplier.mNumber,
    "EmpoweredMeleeDamageTooltip的mMultiplier=2；最高端点替换基础完整式。", 120));
  addFormula(formula("melee_bonus_damage_base", "近战额外伤害基础完整式",
    ADD(P("melee_base_damage_at_character_level"), MUL(P("melee_ad_ratio_at_character_level"), sourceTotalAD())),
    "BonusMeleeDamage=角色等级基础部分+角色等级总攻击力比例×来源总攻击力；已损生命曲线的读取阶段不猜。", 10));
  addFormula(formula("melee_bonus_damage_max", "近战额外伤害最高完整式",
    MUL(P("melee_missing_health_max_multiplier"),
      ADD(P("melee_base_damage_at_character_level"), MUL(P("melee_ad_ratio_at_character_level"), sourceTotalAD()))),
    "EmpoweredMeleeDamageTooltip明确为BonusMeleeDamage×2；只保存最高端点，中间已损生命曲线留待核。", 20));
  addFormula(formula("style_move_speed_ratio_total", "当前评价总移动速度比例",
    MUL(P("style_move_speed_ratio_per_grade"), P("actual_style_grade_count")),
    "每评价等级移动速度比例×当前评价等级；应用事件和衰减计时留待运行层。", 30));
}, [], [
  { item: "近战已损生命中间曲线", reason: "当前来源只明确最高端点×2，未猜中间读取阶段。" },
  { item: "评价触发事件与定身突进时点", reason: "保留评价输入和突进距离，事件资格和时序待运行层接线。" },
], "P保留评价、衰减、角色等级阶梯、近战完整式和最高×2端点；角色等级插值和已损生命阶段使用无默认运行输入。");

makeDefinition("Samira", "Q", "交火", 5, (add, addFormula) => {
  add(skillLevel("base_damage", "交火基础物理伤害", "INTEGER", fixedLevelValues("Samira", "Q", "BaseDamage", 5),
    "BaseDamage取索引1至5的0/5/10/15/20。", 10));
  add(fixed("ad_ratio", "交火总攻击力比例", "DECIMAL", dataAt("Samira", "Q", "QADRatio"),
    "DamageCalc的mStat=2且未给formula，读取来源总攻击力；QADRatio=1.1。", 20));
  add(fixed("crit_damage_modifier", "交火暴击伤害修正比例", "DECIMAL", dataAt("Samira", "Q", "CritDamageMod"),
    "CriticalDamageCalc倍率=1+CritDamageMod×(mStat9-1)，保留原树0.5。", 30));
  add(fixed("lifesteal_effectiveness_ratio", "交火生命偷取效能比例", "DECIMAL", dataAt("Samira", "Q", "LifestealMod"),
    "当前正文明确生命偷取效能100%，保存为比例1。", 40));
  add(fixed("critical_hit_eligible", "交火可暴击", "INTEGER", 1,
    "当前正文和CriticalDamageCalc均保留暴击分支；实际暴击触发由运行输入决定。", 50));
  add(runtime("actual_crit_multiplier", "交火实际暴击倍率", "DECIMAL",
    "CriticalDamageCalc的mStat9未绑定到已有属性枚举；运行层提供实际暴击倍率，不设默认。", 60));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Samira", "Q").spellCastTime),
    "spellCastTime=0.25秒且mCastTime为空，转换为250毫秒。", 70));
  add(fixed("critical_multiplier_base", "暴击倍率基准", "DECIMAL", 1,
    "CriticalDamageCalc的mMultiplier第一项为Number=1；用于保持完整二元倍率树。", 80));
  addFormula(formula("physical_damage", "交火单一敌人物理伤害",
    ADD(P("base_damage"), MUL(P("ad_ratio"), sourceTotalAD())),
    "DamageCalc=BaseDamage+1.1×来源总攻击力；近战和远程共用该主伤害式。", 10));
  addFormula(formula("critical_physical_damage", "交火暴击物理伤害",
    MUL(
      ADD(P("base_damage"), MUL(P("ad_ratio"), sourceTotalAD())),
      ADD(P("critical_multiplier_base"), MUL(P("crit_damage_modifier"),
        SUB(P("actual_crit_multiplier"), P("critical_multiplier_base"))))
    ),
    "CriticalDamageCalc=DamageCalc×[1+0.5×(实际mStat9-1)]；实际暴击倍率为无默认运行输入。", 20));
}, [
  { item: "冲刺沿途额外敌人", reason: "只保留当前一对一目标命中，沿途额外目标分支排除。" },
], [
  { item: "暴击实际触发与mStat9归属", reason: "保留暴击完整倍率树，实际触发资格和倍率输入待运行层提供。" },
], "Q主伤害树与暴击修改树分开保存；未把暴击倍率猜成已有暴击伤害属性。");

makeDefinition("Samira", "W", "锋旋", 5, (add, addFormula) => {
  add(skillLevel("base_damage", "锋旋每段基础物理伤害", "INTEGER", fixedLevelValues("Samira", "W", "BaseDamage", 5),
    "BaseDamage取索引1至5的20/35/50/65/80。", 10));
  add(fixed("bonus_ad_ratio", "锋旋每段额外攻击力比例", "DECIMAL", 0.5,
    "DamageCalc的mStat=2、mStatFormula=2且系数0.5，读取来源额外攻击力。", 20));
  add(fixed("slash_duration_ms", "锋旋持续（毫秒）", "INTEGER", toMs(dataAt("Samira", "W", "SlashDuration")),
    "SlashDuration=0.75秒，转换为750毫秒。", 30));
  add(fixed("same_target_hit_count", "锋旋同一目标命中次数", "INTEGER", 2,
    "当前正文明确W对同一敌人造成两次斩击；两段各消费同一每段伤害式。", 40));
  add(fixed("projectile_interception_enabled", "锋旋弹体拦截", "INTEGER", 1,
    "当前正文明确W可拦截弹体；只保留资格事实，不创建额外目标结果。", 50));
  addFormula(formula("physical_damage_per_hit", "锋旋单段物理伤害",
    ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), sourceBonusAD())),
    "DamageCalc=基础伤害+0.5×来源额外攻击力；两次同敌命中由命中次数参数表示，不把两段错误合并成一次未知事件。", 10));
}, [
  { item: "额外敌人", reason: "范围只保留同一敌人的两段命中。" },
], [
  { item: "施法时间", reason: "mCastTime=0.01与spellCastTime=0.25秒冲突，不选择任一字段入候选。" },
], "W严格保留两次同敌命中和弹体拦截，施法时间双字段冲突单列待核。");

makeDefinition("Samira", "E", "狂飙", 5, (add, addFormula) => {
  add(skillLevel("damage_base", "狂飙基础魔法伤害", "INTEGER", fixedLevelValues("Samira", "E", "BaseDamage", 5),
    "BaseDamage取索引1至5的50/60/70/80/90。", 10));
  add(skillLevel("bonus_attack_speed_ratio", "狂飙自身攻击速度比例", "DECIMAL", fixedLevelValues("Samira", "E", "BonusAttackSpeed", 5),
    "BonusAttackSpeed取索引1至5的20%/25%/30%/35%/40%，按比例保存。", 20));
  add(fixed("attack_speed_duration_ms", "狂飙自身攻击速度持续（毫秒）", "INTEGER", toMs(dataAt("Samira", "E", "AttackSpeedDuration")),
    "AttackSpeedDuration=5秒，转换为5000毫秒。", 30));
  add(fixed("dash_damage_bonus_ad_ratio", "狂飙冲刺额外攻击力比例", "DECIMAL", 0.2,
    "DashDamage的mStat=2、mStatFormula=2且系数0.2，读取来源额外攻击力。", 40));
  add(fixed("champion_kill_reset_window_ms", "狂飙英雄击杀重置窗口（毫秒）", "INTEGER", 3000,
    "当前正文明确击杀英雄可在3秒内重置资格，保存为3000毫秒；事件时点待接线。", 50));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Samira", "E").spellCastTime),
    "仅spellCastTime=0.15秒且mCastTime为空，转换为150毫秒。", 60));
  addFormula(formula("dash_magic_damage", "狂飙单一敌人魔法伤害",
    ADD(P("damage_base"), MUL(P("dash_damage_bonus_ad_ratio"), sourceBonusAD())),
    "DashDamage=基础伤害+0.2×来源额外攻击力；当前目标冲刺命中保留。", 10));
}, [
  { item: "沿途额外敌人与建筑伤害", reason: "一对一只保留当前目标冲刺命中。" },
], [
  { item: "英雄击杀重置事件", reason: "3秒窗口数值明确，击杀资格和重置时点待运行层接线。" },
], "E的自身攻击速度和单一目标伤害保留；3秒重置窗口来自当前正文，不伪造重置触发。");

makeDefinition("Samira", "R", "炼狱扳机", 3, (add, addFormula) => {
  add(skillLevel("base_damage", "炼狱扳机每发基础物理伤害", "INTEGER", fixedLevelValues("Samira", "R", "BaseDamage", 3),
    "BaseDamage取索引1至3的20/40/60。", 10));
  add(fixed("ad_ratio", "炼狱扳机每发总攻击力比例", "DECIMAL", dataAt("Samira", "R", "ADRatio"),
    "DamageCalc的mStat=2且未给formula，读取来源总攻击力；ADRatio=0.3。", 20));
  add(fixed("lifesteal_effectiveness_ratio", "炼狱扳机生命偷取效能比例", "DECIMAL", dataAt("Samira", "R", "LifestealMod"),
    "当前正文明确生命偷取效能100%，保存为比例1。", 30));
  add(fixed("duration_ms", "炼狱扳机持续（毫秒）", "INTEGER", 2000,
    "当前正文明确持续2秒，转换为2000毫秒。", 40));
  add(fixed("shot_count", "炼狱扳机射击次数", "INTEGER", 10,
    "当前正文明确2秒内射击10次；每发消费一次单发伤害式，事件层决定具体时点。", 50));
  add(fixed("required_style_grade", "炼狱扳机所需评价等级", "INTEGER", 6,
    "当前正文明确达到S评价才能施放；6对应E至S评价等级，不由公式计算。", 60));
  add(fixed("critical_hit_eligible", "炼狱扳机可暴击", "INTEGER", 1,
    "当前正文明确R伤害可以暴击；实际暴击倍率独立使用运行输入。", 70));
  add(runtime("actual_crit_multiplier", "炼狱扳机实际暴击倍率", "DECIMAL",
    "CriticalDamageCalc的mStat9未绑定到已有属性枚举；运行层提供实际倍率，不设默认。", 80));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Samira", "R").spellCastTime),
    "spellCastTime=0.25秒且mCastTime为空，转换为250毫秒。", 90));
  addFormula(formula("physical_damage_per_shot", "炼狱扳机单发物理伤害",
    ADD(P("base_damage"), MUL(P("ad_ratio"), sourceTotalAD())),
    "DamageCalc=基础伤害+0.3×来源总攻击力；一对一只计算当前目标的每发伤害。", 10));
  addFormula(formula("critical_physical_damage_per_shot", "炼狱扳机暴击单发物理伤害",
    MUL(ADD(P("base_damage"), MUL(P("ad_ratio"), sourceTotalAD())), P("actual_crit_multiplier")),
    "CriticalDamageCalc=DamageCalc×实际mStat9；不把未消费的其他倍率或小兵修正混入。", 20));
}, [
  { item: "小兵25%伤害与周围额外敌人", reason: "兵线专用修正及额外目标不进入本批一对一请求。" },
], [
  { item: "S评价消耗与10发时点", reason: "评价输入、持续和次数已保存；消耗及每发事件时点待运行层接线。" },
], "R保留2秒、10发、S评价资格、生命偷取与暴击完整分支；不将小兵修正或未消费BaseMSBonus带入。");

makeDefinition("Nilah", "P", "喜色川流", 1, () => {}, [
  { item: "P整槽", reason: "本轮明确排除补刀经验、经验分享与第三友方治疗护盾收益；不将友方技能收益改写成自身无条件收益。" },
], [
  { item: "友方治疗护盾放大", reason: "范围外分支保留来源文本，未创建参数或效果。" },
], "P按本批范围整槽跳过；主体、分类、图片和现有组成均由当前保护快照只读保护。");

makeDefinition("Nilah", "Q", "游刃万变", 5, (add, addFormula) => {
  add(skillLevel("base_damage", "游刃万变基础物理伤害", "INTEGER", fixedLevelValues("Nilah", "Q", "BaseDamage", 5),
    "BaseDamage取索引1至5的0/10/20/30/40；索引0=-10是占位。", 10));
  add(fixed("ad_ratio", "游刃万变总攻击力比例", "DECIMAL", dataAt("Nilah", "Q", "QADRatio"),
    "DamageCalc的mStat=2且未给formula，读取来源总攻击力；QADRatio=1。", 20));
  add(fixed("crit_scaling", "游刃万变暴击属性缩放", "DECIMAL", dataAt("Nilah", "Q", "ActiveCritScaling"),
    "DamageCalc根倍率消费ActiveCritScaling=0.7；mStat8/mStat9本身不绑定已有枚举。", 30));
  add(fixed("crit_heal_scalar", "游刃万变暴击生命偷取缩放", "DECIMAL", dataAt("Nilah", "Q", "CritHealScalar"),
    "CritLifesteal消费CritHealScalar=0.2；mStat8作为实际运行输入。", 40));
  add(fixed("crit_armor_pen_scalar", "游刃万变暴击护甲穿透缩放", "DECIMAL", dataAt("Nilah", "Q", "CritArmorPenScalar"),
    "CritArmorPen消费CritArmorPenScalar=0.3；mStat8作为实际运行输入。", 50));
  add(fixed("buff_duration_ms", "游刃万变强化持续（毫秒）", "INTEGER", toMs(dataAt("Nilah", "Q", "BuffDuration")),
    "BuffDuration=4秒，转换为4000毫秒。", 60));
  add(fixed("range_increase_points", "游刃万变攻击距离增加点数", "INTEGER", dataAt("Nilah", "Q", "RangeIncrease"),
    "RangeIncrease=125，只保存自身攻击距离强化的来源数值。", 70));
  add(fixed("overheal_shield_duration_ms", "游刃万变过量治疗护盾持续（毫秒）", "INTEGER", toMs(dataAt("Nilah", "Q", "ShieldDuration")),
    "当前正文明确过量治疗转为护盾并持续4秒，转换为4000毫秒；护盾值和应用事件待接线。", 80));
  add(fixed("attack_speed_interpolation_min_percent_points", "游刃万变攻击速度插值下限百分数点", "DECIMAL",
    calc("Nilah", "Q", "BonusAttackSpeedCalc").mFormulaParts[0].mStartValue,
    "BonusAttackSpeedCalc角色等级插值下限10；只保存端点，未知等级求值不猜。", 90));
  add(fixed("attack_speed_interpolation_max_percent_points", "游刃万变攻击速度插值上限百分数点", "DECIMAL",
    calc("Nilah", "Q", "BonusAttackSpeedCalc").mFormulaParts[0].mEndValue,
    "BonusAttackSpeedCalc角色等级插值上限60；只保存端点，未知等级求值不猜。", 100));
  add(runtime("actual_attack_speed_percent_points", "游刃万变角色等级实际攻击速度百分数点", "DECIMAL",
    "BonusAttackSpeedCalc的角色等级中间值由运行层提供，不使用端点插值猜测。", 110));
  add(runtime("actual_mstat8_value", "游刃万变原始mStat8输入", "DECIMAL",
    "DamageCalc、CritLifesteal和CritArmorPen均消费mStat8；其属性含义未证，运行层提供原始值，不设默认。", 120));
  add(runtime("actual_mstat9_value", "游刃万变原始mStat9输入", "DECIMAL",
    "DamageCalc消费mStat9；其暴击倍率含义未证，运行层提供原始值，不设默认。", 130));
  add(fixed("critical_hit_eligible", "游刃万变可暴击", "INTEGER", 1,
    "当前主树含完整暴击属性乘区；实际暴击触发由运行层决定。", 140));
  add(fixed("critical_multiplier_base", "暴击倍率基准", "DECIMAL", 1,
    "DamageCalc根mMultiplier第一项为Number=1，作为完整倍率树的基准。", 150));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Nilah", "Q").spellCastTime),
    "仅spellCastTime=0.25秒且mCastTime为空，转换为250毫秒。", 160));
  const criticalMultiplier = ADD(P("critical_multiplier_base"),
    MUL(P("actual_mstat8_value"), MUL(P("crit_scaling"), SUB(P("actual_mstat9_value"), P("critical_multiplier_base")))));
  addFormula(formula("physical_damage_with_crit_scaling", "游刃万变含暴击属性缩放的单一敌人物理伤害",
    MUL(ADD(P("base_damage"), MUL(P("ad_ratio"), sourceTotalAD())), criticalMultiplier),
    "DamageCalc完整树=[BaseDamage+1×来源总攻击力]×[1+mStat8×0.7×(mStat9-1)]；不能拆成无暴击基础伤害后漏掉根倍率。", 10));
  addFormula(formula("critical_lifesteal_ratio", "游刃万变暴击生命偷取比例",
    MUL(P("actual_mstat8_value"), P("crit_heal_scalar")),
    "CritLifesteal=mStat8×0.2；mStat8保留为原始运行输入。", 20));
  addFormula(formula("critical_armor_penetration_ratio", "游刃万变暴击护甲穿透比例",
    MUL(P("actual_mstat8_value"), P("crit_armor_pen_scalar")),
    "CritArmorPen=mStat8×0.3；只保存比例结果，不创建目标护甲结算。", 30));
}, [
  { item: "小兵/野怪修正与低血小兵处决", reason: "MinionMod、MonsterMod和小兵专用资格排除。" },
], [
  { item: "mStat8/mStat9、攻击速度等级曲线", reason: "保留原始运行输入和等级端点，未猜属性枚举或中间曲线。" },
], "Q主树已经包含mStat8/mStat9整个暴击乘区；只将mStat8/9作为无默认原始输入，不绑定为暴击几率或暴击伤害属性。");

makeDefinition("Nilah", "W", "轻纱飞漾", 5, add => {
  add(skillLevel("self_move_speed_ratio", "轻纱飞漾自身移动速度比例", "DECIMAL",
    fixedLevelValues("Nilah", "W", "MoveSpeedPercent", 5),
    "MoveSpeedPercent取索引1至5的15%至25%，按比例保存。", 10));
  add(fixed("self_duration_ms", "轻纱飞漾自身持续（毫秒）", "INTEGER", toMs(dataAt("Nilah", "W", "BaseDuration")),
    "BaseDuration=2.25秒，转换为2250毫秒。", 20));
  add(fixed("magic_damage_reduction_ratio", "轻纱飞漾自身魔法伤害减免比例", "DECIMAL",
    dataAt("Nilah", "W", "MagicDamageReduction"), "MagicDamageReduction=0.25，保留自身减免比例。", 30));
  add(fixed("self_basic_attack_dodge_enabled", "轻纱飞漾自身躲避普通攻击", "INTEGER", 1,
    "当前正文明确自身躲避即将到来的普通攻击；只保存资格事实，不创建拦截事件。", 40));
  add(fixed("self_ghost_enabled", "轻纱飞漾自身幽灵状态", "INTEGER", 1,
    "当前正文明确自身进入幽灵状态；效果持续由self_duration_ms表示。", 50));
}, [
  { item: "友方分享持续与接触范围", reason: "ShareBaseDuration、ExtensionBonus和AreaTriggerSize属于第三友方/额外范围分支。" },
], [
  { item: "施法时间与冷却不消耗标志", reason: "mCastTime=0.013与spellCastTime=0冲突；mDoesNotConsumeCooldown与冷却表并存，均待系统语义核对。" },
], "W仅保留自身移速、幽灵、减伤和躲避收益；第三友方分享和时间冲突不写入。");

makeDefinition("Nilah", "E", "纵情逐流", 5, (add, addFormula) => {
  add(fixed("charge_count", "纵情逐流充能次数", "INTEGER", 2,
    "当前正文明确E有两次充能；充能恢复事件不由次数参数自动生成。", 10));
  add(fixed("charge_segment_cooldown_ms", "纵情逐流充能段冷却（毫秒）", "INTEGER",
    toMs(spell("Nilah", "E").cooldownTime[0]),
    "客户端cooldownTime=0.5秒对应段冷却，转换为500毫秒；不把段冷却当整轮充能恢复时间。", 20));
  add(skillLevel("damage_base", "纵情逐流基础物理伤害", "INTEGER", fixedLevelValues("Nilah", "E", "BaseDamage", 5),
    "BaseDamage取索引1至5的60/70/80/90/100。", 30));
  add(fixed("bonus_ad_ratio", "纵情逐流额外攻击力比例", "DECIMAL", 0.20000000298023224,
    "DashDamage的mStat=2、mStatFormula=2且系数0.2，读取来源额外攻击力。", 40));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Nilah", "E").spellCastTime),
    "仅spellCastTime=0.15秒且mCastTime为空，转换为150毫秒。", 50));
  addFormula(formula("dash_physical_damage", "纵情逐流单一敌人物理伤害",
    ADD(P("damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())),
    "DashDamage=基础伤害+0.2×来源额外攻击力；途经额外敌人不在本公式自动展开。", 10));
}, [
  { item: "途经额外敌人", reason: "本批只保留当前目标冲刺命中。" },
], [
  { item: "两次充能的整轮恢复时点", reason: "充能次数和0.5秒段冷却分开保存，整轮恢复与事件时点待运行层接线。" },
], "E不把0.5秒段冷却误作整轮恢复时间；mStat2/2保留来源额外攻击力。");

makeDefinition("Nilah", "R", "神恩激荡", 3, (add, addFormula) => {
  add(fixed("duration_ms", "神恩激荡持续（毫秒）", "INTEGER", toMs(dataAt("Nilah", "R", "Duration")),
    "Duration=6秒，转换为6000毫秒。", 10));
  add(skillLevel("damage_base", "神恩激荡爆发基础物理伤害", "INTEGER", fixedLevelValues("Nilah", "R", "DamageBase", 3),
    "DamageBase取索引1至3的125/225/325。", 20));
  add(fixed("damage_bonus_ad_ratio", "神恩激荡爆发额外攻击力比例", "DECIMAL", 1,
    "DamageCalc的mStat=2、mStatFormula=2且系数1，读取来源额外攻击力。", 30));
  add(skillLevel("damage_per_tick_base", "神恩激荡每跳基础物理伤害", "INTEGER", fixedLevelValues("Nilah", "R", "DamagePerTick", 3),
    "DamagePerTick取索引1至3的15/25/35；正文消费每跳式。", 40));
  add(fixed("damage_per_tick_bonus_ad_ratio", "神恩激荡每跳额外攻击力比例", "DECIMAL", 0.10000000149011612,
    "DamagePerTickCalc的mStat=2、mStatFormula=2且系数0.1，读取来源额外攻击力。", 50));
  add(fixed("display_sustained_damage_multiplier", "神恩激荡展示持续伤害倍率", "INTEGER", 4,
    "正文消费tooltipOnly的DamagePerTickCalcTooltip=4×每跳式；实际跳数另有NumTicks冲突，不能由此宣称总跳数。", 60));
  add(fixed("source_num_ticks", "神恩激荡原始跳数", "INTEGER", dataAt("Nilah", "R", "NumTicks"),
    "原树NumTicks=6；与当前正文消费的4倍展示式不一致，保留来源值并列待核。", 70));
  add(fixed("tick_delay_ms", "神恩激荡每跳间隔（毫秒）", "INTEGER", toMs(dataAt("Nilah", "R", "TickDelay")),
    "TickDelay=0.2秒，转换为200毫秒；只保存来源时序值，不创建周期过程。", 80));
  add(fixed("slow_percent_points", "神恩激荡减速百分数点", "DECIMAL",
    Math.abs(percentPoints(dataAt("Nilah", "R", "Microslow"))),
    "Microslow原始值为-0.1，正文语义是10%减速；保存正的减速幅度百分数点，避免把负移速修正称为负减速。", 90));
  add(fixed("self_healing_base_ratio", "神恩激荡自身治疗基础比例", "DECIMAL", 0.20000000298023224,
    "ChampHealingPercent第一项Number=0.2，按比例保存。", 100));
  add(fixed("self_healing_mstat8_ratio", "神恩激荡自身治疗mStat8比例", "DECIMAL", 0.10000000149011612,
    "ChampHealingPercent第二项mStat=8、系数0.1；mStat8不绑定已有属性，实际值外供。", 110));
  add(runtime("actual_mstat8_value", "神恩激荡原始mStat8输入", "DECIMAL",
    "ChampHealingPercent消费mStat8；属性含义未证，运行层提供原始值，不设默认。", 120));
  add(runtime("actual_q_crit_lifesteal_ratio", "神恩激荡当前Q生命偷取比例", "DECIMAL",
    "正文要求R自身治疗比例加上Q的CritLifesteal；跨技能实际值由运行层提供，不能复制Q的未知mStat8为默认。", 130));
  add(runtime("actual_current_enemy_pre_mitigation_damage", "神恩激荡当前敌方折前伤害", "DECIMAL",
    "自身治疗量按当前目标伤害与治疗比例求值；运行层提供当前合资格折前伤害，不设默认。", 140));
  add(fixed("overheal_shield_duration_ms", "神恩激荡过量治疗护盾持续（毫秒）", "INTEGER",
    toMs(dataAt("Nilah", "R", "Duration")),
    "当前正文过量治疗转为自身护盾并持续6秒，转换为6000毫秒；未消费ShieldCalc不作为护盾值。", 150));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER", toMs(spell("Nilah", "R").spellCastTime),
    "仅spellCastTime=0.25秒且mCastTime为空，转换为250毫秒。", 160));
  addFormula(formula("burst_physical_damage", "神恩激荡单一敌人爆发物理伤害",
    ADD(P("damage_base"), MUL(P("damage_bonus_ad_ratio"), sourceBonusAD())),
    "DamageCalc=爆发基础伤害+1×来源额外攻击力；额外友方治疗不加入。", 10));
  addFormula(formula("damage_per_tick", "神恩激荡单跳物理伤害",
    ADD(P("damage_per_tick_base"), MUL(P("damage_per_tick_bonus_ad_ratio"), sourceBonusAD())),
    "DamagePerTickCalc=每跳基础伤害+0.1×来源额外攻击力。", 20));
  addFormula(formula("tooltip_sustained_damage", "神恩激荡正文持续伤害展示式",
    MUL(P("display_sustained_damage_multiplier"),
      ADD(P("damage_per_tick_base"), MUL(P("damage_per_tick_bonus_ad_ratio"), sourceBonusAD()))),
    "DamagePerTickCalcTooltip当前正文消费4×每跳式；NumTicks=6仅作为冲突来源值保留。", 30));
  addFormula(formula("self_healing_ratio", "神恩激荡自身治疗比例",
    ADD(ADD(P("self_healing_base_ratio"), MUL(P("self_healing_mstat8_ratio"), P("actual_mstat8_value"))),
      P("actual_q_crit_lifesteal_ratio")),
    "自身治疗比例=0.2+0.1×实际mStat8+Q的CritLifesteal；三项均保留，不把Q未知值默认为0。", 40));
  addFormula(formula("self_healing_amount", "神恩激荡自身治疗量",
    MUL(
      ADD(ADD(P("self_healing_base_ratio"), MUL(P("self_healing_mstat8_ratio"), P("actual_mstat8_value"))),
        P("actual_q_crit_lifesteal_ratio")),
      P("actual_current_enemy_pre_mitigation_damage")
    ),
    "自身治疗量=完整治疗比例×当前目标合资格折前伤害；实际目标伤害由运行层提供。", 50));
}, [
  { item: "附近友方治疗和非英雄10%治疗", reason: "纯额外友方或非英雄分支不进入本批。" },
  { item: "ShieldCalc", reason: "当前正文未消费ShieldCalc，不能把65/115/165+额外攻击力式当作过量治疗护盾量。" },
], [
  { item: "NumTicks与实际跳时序", reason: "原树6跳与正文4倍展示式冲突；保留二者来源，实际跳数由运行层核对。" },
  { item: "治疗阶段与护盾应用", reason: "保留自身治疗比例、折前伤害输入和护盾持续，应用阶段及过量金额待接线。" },
], "R同时保留4倍正文持续伤害展示式、每跳式、mStat8治疗比例和Q生命偷取补项；未消费ShieldCalc不进入写入计划。");

makeDefinition("Smolder", "P", "龙之研习", 1, (add, addFormula) => {
  add(fixed("q_damage_per_stack_ratio", "Q每层额外魔法伤害比例", "DECIMAL", dataAt("Smolder", "P", "QDamagePerStack"),
    "Passive_QDamageIncrease消费QDamagePerStack=0.25。", 10));
  add(fixed("w_damage_per_stack", "W每层额外魔法伤害", "DECIMAL", dataAt("Smolder", "P", "WDamagePerStack"),
    "Passive_WDamageIncrease消费WDamagePerStack=0.55。", 20));
  add(fixed("e_damage_per_stack", "E每层每击额外魔法伤害", "DECIMAL", dataAt("Smolder", "P", "EDamagePerStack"),
    "EBonusDamage消费EDamagePerStack=0.08。", 30));
  add(fixed("e_stacks_per_attack", "E每增加一发所需层数", "INTEGER", dataAt("Smolder", "P", "EStacksPerAttackTooltip"),
    "当前正文明确每100层获得一个额外弹体；只保存增加条件，不把小数层数当弹体次数。", 40));
  add(fixed("q_crit_ratio", "Q额外魔法伤害暴击属性比例", "DECIMAL", dataAt("Smolder", "P", "QCritRatio"),
    "Passive_QDamageIncrease根mStat8×QCritRatio×(mStat9-1)，QCritRatio=1.2；mStat8/9保持原始输入。", 50));
  add(fixed("e_crit_ratio", "E额外魔法伤害暴击属性比例", "DECIMAL",
    calc("Smolder", "P", "EBonusDamage").mMultiplier.mSubparts[1].mPart1.mCoefficient,
    "EBonusDamage根mStat8系数0.6×(mStat9-1)，保留0.6。", 60));
  add(runtime("actual_stack_count", "龙之研习当前层数", "INTEGER",
    "层数允许作为明确战前输入；运行层提供当前整数层数，不从兵野来源自动叠加。", 70));
  add(runtime("actual_mstat8_value", "龙之研习原始mStat8输入", "DECIMAL",
    "Q/E额外魔伤树均消费mStat8；属性含义未证，运行层提供原始值，不设默认。", 80));
  add(runtime("actual_mstat9_value", "龙之研习原始mStat9输入", "DECIMAL",
    "Q/E额外魔伤树均消费mStat9；暴击倍率含义未证，运行层提供原始值，不设默认。", 90));
  add(fixed("crit_multiplier_base", "暴击倍率基准", "DECIMAL", 1,
    "P两个倍率根均以Number=1为基准；用于保持原树完整二元结构。", 100));
  add(fixed("hero_hit_stack_gain", "技能命中英雄叠层", "INTEGER", 1,
    "当前正文明确技能命中英雄获得一层；事件资格待运行层接线。", 110));
  add(fixed("q_kill_self_enemy_stack_gain", "Q击杀自身敌人叠层", "INTEGER", 1,
    "当前正文明确Q击杀敌人获得一层；仅保存自身敌人资格，不展开兵野来源。", 120));
  const qMultiplier = ADD(P("crit_multiplier_base"),
    MUL(MUL(P("actual_mstat8_value"), P("q_crit_ratio")), SUB(P("actual_mstat9_value"), P("crit_multiplier_base"))));
  const eMultiplier = ADD(P("crit_multiplier_base"),
    MUL(MUL(P("actual_mstat8_value"), P("e_crit_ratio")), SUB(P("actual_mstat9_value"), P("crit_multiplier_base"))));
  addFormula(formula("q_bonus_magic_damage", "Q每层额外魔法伤害完整式",
    MUL(MUL(P("q_damage_per_stack_ratio"), P("actual_stack_count")), qMultiplier),
    "Passive_QDamageIncrease=0.25×层数×[1+实际mStat8×1.2×(实际mStat9-1)]；保留原树完整乘区。", 10));
  addFormula(formula("w_bonus_magic_damage", "W每层额外魔法伤害完整式",
    MUL(P("w_damage_per_stack"), P("actual_stack_count")),
    "Passive_WDamageIncrease=0.55×层数；当前一对一只随W英雄爆炸消费一次。", 20));
  addFormula(formula("e_bonus_magic_damage_per_hit", "E每击额外魔法伤害完整式",
    MUL(MUL(P("e_damage_per_stack"), P("actual_stack_count")), eMultiplier),
    "EBonusDamage=0.08×层数×[1+实际mStat8×0.6×(实际mStat9-1)]；每击消费，弹数由E独立整数输入。", 30));
}, [
  { item: "兵野叠层来源", reason: "小兵和野怪来源排除；已有层数仍作为战前输入保留。" },
  { item: "未消费扩展阈值占位", reason: "Tier3_Breakpoint与Q_tier3_bonus_burn不在当前P计算树，且扩展文本未启用，不进入请求计划。" },
], [
  { item: "叠层事件与mStat8/mStat9属性", reason: "保留明确英雄命中和自身Q击杀资格，实际事件与原始属性输入待运行层提供。" },
], "P完整保存Q/W/E三类层数伤害；Q/E的mStat8/9只作为无默认原始输入，未绑定为暴击几率或额外暴击伤害属性。");

makeDefinition("Smolder", "Q", "超级灼热龙息", 5, (add, addFormula) => {
  add(skillLevel("base_damage", "超级灼热龙息基础物理伤害", "INTEGER", fixedLevelValues("Smolder", "Q", "BaseDamage", 5),
    "BaseDamage取索引1至5的60/70/80/90/100；索引0=50是占位。", 10));
  add(fixed("bonus_ad_ratio", "超级灼热龙息额外攻击力比例", "DECIMAL", dataAt("Smolder", "Q", "ADRatio"),
    "TotalDamage的mStat=2、mStatFormula=2且ADRatio=1.3，读取来源额外攻击力。", 20));
  add(fixed("crit_ratio", "超级灼热龙息暴击属性比例", "DECIMAL", dataAt("Smolder", "Q", "CritRatio"),
    "TotalDamage根消费CritRatio=0.75；mStat8/mStat9保留原始输入。", 30));
  add(runtime("actual_mstat8_value", "超级灼热龙息原始mStat8输入", "DECIMAL",
    "TotalDamage根消费mStat8；属性含义未证，运行层提供原始值，不设默认。", 40));
  add(runtime("actual_mstat9_value", "超级灼热龙息原始mStat9输入", "DECIMAL",
    "TotalDamage根消费mStat9；暴击倍率含义未证，运行层提供原始值，不设默认。", 50));
  add(fixed("tier1_stack_threshold", "超级灼热龙息第一层数阈值", "INTEGER", dataAt("Smolder", "Q", "StackTier1"),
    "StackTier1=25；只保存进化资格，不在一对一中自动创建额外爆炸。", 60));
  add(fixed("tier2_stack_threshold", "超级灼热龙息第二层数阈值", "INTEGER", dataAt("Smolder", "Q", "StackTier2"),
    "StackTier2=125；额外后侧爆炸分支不进入当前单敌请求。", 70));
  add(fixed("tier3_stack_threshold", "超级灼热龙息第三层数阈值", "INTEGER", dataAt("Smolder", "Q", "StackTier3"),
    "StackTier3=225；第三阶段灼烧与处决参数保留。", 80));
  add(fixed("burn_duration_ms", "超级灼热龙息灼烧持续（毫秒）", "INTEGER", toMs(dataAt("Smolder", "Q", "Tier3_DotLength")),
    "Tier3_DotLength=3秒，转换为3000毫秒；只保存窗口，不创建周期触发。", 90));
  add(fixed("burn_bonus_ad_ratio", "超级灼热龙息灼烧额外攻击力比例", "DECIMAL",
    calc("Smolder", "Q", "Tier3_Burn").mFormulaParts[0].mCoefficient,
    "Tier3_Burn第一项为mStat2/mStatFormula2系数0.00025，读取来源额外攻击力；mDisplayAsPercent只影响显示。", 100));
  add(fixed("burn_stack_ratio", "超级灼热龙息灼烧层数比例", "DECIMAL", dataAt("Smolder", "Q", "Tier3_Burn_Stack_Mult"),
    "Tier3_Burn第二项消费Tier3_Burn_Stack_Mult；按原始比例保存，不再做百分数点缩放。", 110));
  add(fixed("execute_threshold_start_percent_points", "超级灼热龙息处决起始百分数点", "DECIMAL",
    dataAt("Smolder", "Q", "Tier3_ExecuteThresholdStart"),
    "Tier3_ExecuteThreshold的mFormulaParts消费6.5，根mMultiplier再乘0.01；保留6.5百分数点。", 120));
  add(fixed("percent_points_to_ratio", "百分数点转比例", "DECIMAL",
    calc("Smolder", "Q", "Tier3_ExecuteThreshold").mMultiplier.mNumber,
    "Tier3_ExecuteThreshold根mMultiplier=0.01；只用于6.5×0.01处决阈值，不套到灼烧原始比例。", 130));
  add(fixed("mana_restore", "超级灼热龙息击杀返还法力", "INTEGER", dataAt("Smolder", "Q", "ManaRestore"),
    "当前正文明确目标阵亡时每次施放返还15法力；触发一次性由事件层接线。", 140));
  add(fixed("main_hit_count_per_target", "超级灼热龙息每目标主命中次数", "INTEGER", 1,
    "当前正文明确喷吐一名敌人；同一目标只计一次主命中，不能把额外爆炸自动叠到同一人。", 150));
  add(runtime("actual_stack_count", "超级灼热龙息当前层数", "INTEGER",
    "层数是明确战前输入；运行层提供实际整数层数，不从额外敌人或兵野来源自动叠加。", 160));
  add(runtime("actual_target_max_health", "超级灼热龙息灼烧目标实际最大生命", "DECIMAL",
    "Tier3_Burn结果以目标最大生命为基准；运行层提供实际目标最大生命，不设默认。", 170));
  add(fixed("crit_multiplier_base", "暴击倍率基准", "DECIMAL", 1,
    "TotalDamage根mMultiplier第一项为Number=1，用于完整倍率结构。", 180));
  const multiplier = ADD(P("crit_multiplier_base"),
    MUL(MUL(P("actual_mstat8_value"), P("crit_ratio")), SUB(P("actual_mstat9_value"), P("crit_multiplier_base"))));
  addFormula(formula("physical_damage_with_crit_scaling", "超级灼热龙息单一敌人物理伤害",
    MUL(ADD(P("base_damage"), MUL(P("bonus_ad_ratio"), sourceBonusAD())), multiplier),
    "TotalDamage=[基础伤害+1.3×来源额外攻击力]×[1+实际mStat8×0.75×(实际mStat9-1)]；主命中只消费一次。", 10));
  addFormula(formula("tier3_burn_max_health_ratio", "超级灼热龙息第三阶段灼烧最大生命比例",
    ADD(MUL(P("burn_bonus_ad_ratio"), sourceBonusAD()), MUL(P("burn_stack_ratio"), P("actual_stack_count"))),
    "Tier3_Burn=0.00025×来源额外攻击力+0.00005×层数；这是3秒窗口内的比例，mDisplayAsPercent不再除100。", 20));
  addFormula(formula("tier3_burn_true_damage", "超级灼热龙息第三阶段灼烧真实伤害",
    MUL(
      ADD(MUL(P("burn_bonus_ad_ratio"), sourceBonusAD()), MUL(P("burn_stack_ratio"), P("actual_stack_count"))),
      P("actual_target_max_health")
    ),
    "灼烧真实伤害=完整最大生命比例×目标实际最大生命；不引入原树未消费的1%固定项。", 30));
  addFormula(formula("tier3_execute_health_threshold_ratio", "超级灼热龙息第三阶段处决生命比例",
    MUL(P("percent_points_to_ratio"), P("execute_threshold_start_percent_points")),
    "Tier3_ExecuteThreshold=0.01×6.5=0.065；结果为6.5%生命阈值。", 40));
}, [
  { item: "Tier2后侧爆炸和周围额外敌人", reason: "额外目标专用分支不进入当前一对一请求；层数阈值仍保留。" },
  { item: "Tier3_MonsterCap与minionmod", reason: "野怪上限和兵线修正排除。" },
  { item: "Tier3_TrueDamagePercent", reason: "当前Tier3_Burn树未消费该1%字段，按原树证据留在来源摘要。" },
], [
  { item: "暴击触发和层数阶段事件", reason: "mStat8/mStat9、当前层数、目标最大生命均无默认，资格与事件待运行层接线。" },
], "Q保留主命中完整暴击树、3秒灼烧比例和6.5%处决阈值；未把原树不消费的TrueDamagePercent错误并入灼烧。");

makeDefinition("Smolder", "W", "阿嚏！", 5, (add, addFormula) => {
  add(skillLevel("initial_damage_base", "阿嚏直击基础物理伤害", "INTEGER",
    fixedLevelValues("Smolder", "W", "BaseDamage", 5),
    "BaseDamage取索引1至5的60/70/80/90/100。", 10));
  add(fixed("initial_bonus_ad_ratio", "阿嚏直击额外攻击力比例", "DECIMAL",
    dataAt("Smolder", "W", "HitADRatio"),
    "InitialDamage的mStat=2、mStatFormula=2，读取来源额外攻击力；HitADRatio=0.6。", 20));
  add(skillLevel("explosion_damage_base", "阿嚏英雄爆炸基础物理伤害", "INTEGER",
    fixedLevelValues("Smolder", "W", "ExplosionBaseDamage", 5),
    "ExplosionBaseDamage取索引1至5的10/35/60/85/110；索引0=-15是占位。", 30));
  add(fixed("explosion_bonus_ad_ratio", "阿嚏英雄爆炸额外攻击力比例", "DECIMAL",
    calc("Smolder", "W", "ExplosionDamage").mFormulaParts[1].mCoefficient,
    "ExplosionDamage第二项mStat2/mStatFormula2系数0.5，读取来源额外攻击力。", 40));
  add(fixed("explosion_ap_ratio", "阿嚏英雄爆炸法术强度比例", "DECIMAL",
    calc("Smolder", "W", "ExplosionDamage").mFormulaParts[2].mCoefficient,
    "ExplosionDamage第三项省略mStat的系数0.8，依据当前窄证读取来源总法强。", 50));
  add(fixed("slow_percent_points", "阿嚏减速百分数点", "DECIMAL",
    percentPoints(dataAt("Smolder", "W", "SlowAmount")),
    "SlowAmount=0.35，按正文*100保存为35减速百分数点。", 60));
  add(fixed("slow_duration_ms", "阿嚏减速持续（毫秒）", "INTEGER",
    toMs(dataAt("Smolder", "W", "SlowDuration")),
    "SlowDuration=1.5秒，转换为1500毫秒。", 70));
  add(fixed("same_target_direct_and_explosion", "阿嚏同一目标直击与爆炸均可命中", "INTEGER", 1,
    "当前正文明确命中英雄时爆炸；同一敌人可同时消费直击和英雄爆炸两式。", 80));
  addFormula(formula("initial_physical_damage", "阿嚏直击单一敌人物理伤害",
    ADD(P("initial_damage_base"), MUL(P("initial_bonus_ad_ratio"), sourceBonusAD())),
    "InitialDamage=基础伤害+0.6×来源额外攻击力。", 10));
  addFormula(formula("hero_explosion_physical_damage", "阿嚏英雄爆炸单一敌人物理伤害",
    ADD(
      ADD(P("explosion_damage_base"), MUL(P("explosion_bonus_ad_ratio"), sourceBonusAD())),
      MUL(P("explosion_ap_ratio"), sourceAP())
    ),
    "ExplosionDamage=基础伤害+0.5×来源额外攻击力+0.8×来源总法强；省略mStat的0.8按窄证读取法强。", 20));
}, [
  { item: "后续爆炸75%修正与小兵分支", reason: "扩展多目标/小兵专用修正不进入当前同一敌人主直击+英雄爆炸。" },
], [
  { item: "施法时间", reason: "mCastTime=0.35与spellCastTime=0冲突，不选择任一字段。" },
], "W保留同敌直击与英雄爆炸同时消费，未将多目标后续爆炸修正带入单敌式；省略mStat的0.8法强项完整保留。");

makeDefinition("Smolder", "E", "扑棱，扑棱，扑棱！", 5, (add, addFormula) => {
  add(fixed("flight_duration_ms", "扑棱飞行持续（毫秒）", "INTEGER",
    toMs(dataAt("Smolder", "E", "Duration")),
    "Duration=1.25秒，转换为1250毫秒。", 10));
  add(fixed("self_move_speed_ratio", "扑棱自身移动速度比例", "DECIMAL",
    dataAt("Smolder", "E", "MoveSpeed"),
    "MoveSpeed=0.75，按比例保存为75%。", 20));
  add(fixed("base_attack_count", "扑棱基础弹数", "INTEGER",
    dataAt("Smolder", "E", "NumOfAttacksBase"),
    "TotalNumberOfAttacks基础值=5。", 30));
  add(fixed("attack_count_stack_ratio", "扑棱每层额外弹数比例", "DECIMAL",
    dataAt("Smolder", "E", "NumAttackStackRatio"),
    "TotalNumberOfAttacks每层增加0.01，原树mPrecision=2；只保存未取整原式。", 40));
  add(runtime("actual_stack_count", "扑棱当前层数", "INTEGER",
    "弹数原式消费当前层数；运行层提供实际整数层数，不设默认。", 50));
  add(runtime("actual_attack_count_integer", "扑棱实际向下取整弹数", "INTEGER",
    "当前正文明确弹数向下取整；由于二元表达式没有取整运算，运行层必须提供实际非负整数结果，不能把小数直接当次数。", 60));
  add(skillLevel("damage_base", "扑棱每击基础物理伤害", "INTEGER",
    fixedLevelValues("Smolder", "E", "BaseDamage", 5),
    "BaseDamage取索引1至5的10/15/20/25/30；索引0=5是占位。", 70));
  add(fixed("damage_ad_ratio", "扑棱每击总攻击力比例", "DECIMAL",
    dataAt("Smolder", "E", "ADRatio"),
    "DamagePerHit的mStat=2且未给formula，读取来源总攻击力；ADRatio=0.3。", 80));
  add(fixed("same_target_repeated_hit", "扑棱当前最低生命英雄重复命中", "INTEGER", 1,
    "当前正文明确轰击生命值最低的敌方英雄，允许同一目标多次命中；目标选择和命中事件待接线。", 90));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER",
    toMs(spell("Smolder", "E").spellCastTime),
    "spellCastTime与mCastTime均为0.25秒，语义一致，转换为250毫秒。", 100));
  addFormula(formula("attack_count_unrounded", "扑棱未取整弹数原式",
    ADD(P("base_attack_count"), MUL(P("attack_count_stack_ratio"), P("actual_stack_count"))),
    "TotalNumberOfAttacks=5+0.01×层数；该式只作为来源原式记录，实际次数必须由独立整数输入承接向下取整。", 10));
  addFormula(formula("physical_damage_per_hit", "扑棱每击单一敌人物理伤害",
    ADD(P("damage_base"), MUL(P("damage_ad_ratio"), sourceTotalAD())),
    "DamagePerHit=基础伤害+0.3×来源总攻击力；每击另外消费P的E额外魔伤。", 20));
}, [
  { item: "非英雄优先目标与额外目标", reason: "只保留当前最低生命敌方英雄的一对一重复命中。" },
], [
  { item: "弹数取整和飞行命中时点", reason: "保留未取整原式与无默认整数结果，实际向下取整和命中时点待运行层接线。" },
], "E不把小数弹数直接用于次数；保留5+0.01×层数原式并单独要求实际INTEGER输入。");

makeDefinition("Smolder", "R", "妈----！", 3, (add, addFormula) => {
  add(skillLevel("damage_base", "妈----！外圈基础物理伤害", "INTEGER",
    fixedLevelValues("Smolder", "R", "BaseDamage", 3),
    "BaseDamage取索引1至3的150/250/350；索引0=50是占位。", 10));
  add(fixed("bonus_ad_ratio", "妈----！外圈额外攻击力比例", "DECIMAL",
    dataAt("Smolder", "R", "ADRatio"),
    "TotalDamage的mStat=2、mStatFormula=2，读取来源额外攻击力；ADRatio=1。", 20));
  add(fixed("ap_ratio", "妈----！外圈法术强度比例", "DECIMAL",
    calc("Smolder", "R", "TotalDamage").mFormulaParts[2].mCoefficient,
    "TotalDamage第三项省略mStat的系数1，依据当前窄证读取来源总法强。", 30));
  add(fixed("center_damage_multiplier", "妈----！中心伤害倍率", "DECIMAL",
    dataAt("Smolder", "R", "SweetspotPercentageIncrease"),
    "TooltipOnly_TotalSweetspotDamage将TotalDamage整体乘1.5；中心值替换外圈值，不与外圈相加。", 40));
  add(skillLevel("heal_base", "妈----！自身治疗基础值", "INTEGER",
    fixedLevelValues("Smolder", "R", "MomHeal", 3),
    "MomHeal取索引1至3的100/135/170；索引0=65是占位。", 50));
  add(fixed("heal_bonus_ad_ratio", "妈----！自身治疗额外攻击力比例", "DECIMAL",
    calc("Smolder", "R", "MomHealCalc").mFormulaParts[1].mCoefficient,
    "MomHealCalc第二项mStat2/mStatFormula2系数0.5，读取来源额外攻击力。", 60));
  add(fixed("heal_ap_ratio", "妈----！自身治疗法术强度比例", "DECIMAL",
    calc("Smolder", "R", "MomHealCalc").mFormulaParts[2].mCoefficient,
    "MomHealCalc第三项省略mStat的系数0.75，依据当前窄证读取来源总法强。", 70));
  add(fixed("slow_percent_points", "妈----！减速百分数点", "DECIMAL",
    percentPoints(dataAt("Smolder", "R", "SlowAmount")),
    "SlowAmount=0.4，按正文*100保存为40减速百分数点。", 80));
  add(fixed("slow_duration_ms", "妈----！减速持续（毫秒）", "INTEGER",
    toMs(dataAt("Smolder", "R", "SlowDuration")),
    "SlowDuration=2秒，转换为2000毫秒。", 90));
  add(fixed("center_replaces_outer_damage", "妈----！中心伤害替换外圈", "INTEGER", 1,
    "当前正文明确中心敌人转而受到中心伤害；1表示替换，不将1.5倍再叠加到外圈结果。", 100));
  add(fixed("self_heal_if_mom_hits_smolder", "妈----！龙母命中自身时治疗", "INTEGER", 1,
    "当前正文明确龙母命中斯莫德时消费MomHealCalc；实际命中事件待接线。", 110));
  add(fixed("cast_time_ms", "施法时间（毫秒）", "INTEGER",
    toMs(spell("Smolder", "R").spellCastTime),
    "spellCastTime与mCastTime均为0.75秒，语义一致，转换为750毫秒。", 120));
  addFormula(formula("outer_physical_damage", "妈----！外圈单一敌人物理伤害",
    ADD(
      ADD(P("damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())),
      MUL(P("ap_ratio"), sourceAP())
    ),
    "TotalDamage=基础伤害+1×来源额外攻击力+1×来源总法强；龙母是技能载体，不当作独立召唤物技能组。", 10));
  addFormula(formula("center_physical_damage", "妈----！中心单一敌人物理伤害",
    MUL(
      P("center_damage_multiplier"),
      ADD(
        ADD(P("damage_base"), MUL(P("bonus_ad_ratio"), sourceBonusAD())),
        MUL(P("ap_ratio"), sourceAP())
      )
    ),
    "中心命中=1.5×外圈完整式；中心结果替换外圈结果。", 20));
  addFormula(formula("self_healing_amount", "妈----！命中自身治疗量",
    ADD(
      ADD(P("heal_base"), MUL(P("heal_bonus_ad_ratio"), sourceBonusAD())),
      MUL(P("heal_ap_ratio"), sourceAP())
    ),
    "MomHealCalc=基础治疗+0.5×来源额外攻击力+0.75×来源总法强；只在龙母命中斯莫德资格成立时消费。", 30));
}, [
  { item: "小兵50%修正与声音/视觉字段", reason: "兵线专用修正、声音和视觉参数不进入当前一对一战斗请求。" },
], [
  { item: "冷却不消耗标志", reason: "mDoesNotConsumeCooldown与冷却表并存，实际系统语义待核；未以任一侧覆盖另一侧。" },
], "R保留外圈、中心替换、命中自身治疗和减速；法强项来自省略mStat的原树系数，未将龙母扩展成独立召唤物。");

const order = [
  "urgot_p", "urgot_q", "urgot_w", "urgot_e", "urgot_r",
  "samira_p", "samira_q", "samira_w", "samira_e", "samira_r",
  "nilah_p", "nilah_q", "nilah_w", "nilah_e", "nilah_r",
  "smolder_p", "smolder_q", "smolder_w", "smolder_e", "smolder_r",
];
for (const skillKey of order) {
  if (!definitions[skillKey]) throw new Error("未生成技能 " + skillKey);
  const skill = definitions[skillKey];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "OPERATION" && (!Array.isArray(node.operands) || node.operands.length !== 2)) {
      throw new Error("公式不是二元运算 " + skillKey);
    }
    if (Array.isArray(node.operands)) node.operands.forEach(visit);
  };
  for (const f of skill.write.formulas) visit(f.expression);
  for (const p of skill.write.parameters) {
    if (p.valueType === "INTEGER") {
      const values = p.valueMode === "FIXED" ? [p.fixedValue] : Object.values(p.levelValues || {});
      if (values.some(value => value !== null && (!Number.isInteger(value) || value < 0))) {
        throw new Error("INTEGER含非整数或负值 " + skillKey + "/" + p.parameterKey);
      }
    }
    if (p.parameterKey.endsWith("_ms") && p.valueMode === "FIXED" &&
        (p.fixedValue < 0 || !Number.isInteger(p.fixedValue))) {
      throw new Error("毫秒字段不合规 " + skillKey + "/" + p.parameterKey);
    }
  }
}

const reusedPublicParameters = reuseList.map(item => {
  const route = "/skills/" + item.skillKey + "/parameters/" + item.parameterKey;
  const request = protection.requests.find(entry => entry.route === route);
  if (!request) throw new Error("复用参数保护缺失 " + route);
  return {
    skillKey: item.skillKey,
    parameterKey: item.parameterKey,
    source: "输入包/参考资料/公共参数复用清单.json",
    post: false,
    detailRoute: route,
    expected: clone(request.data),
    expectedSha256: sha256(JSON.stringify(request.data)),
  };
});

const sourceFiles = [
  ["来源绑定与当前文本.json", bindingFile],
  ["输入版本.json", versionFile],
  ["主负责人范围与核对要求.md", rangeDoc],
  ["Cursor复核后补充.md", cursorSupplement],
  ["参考资料/当前20槽保护快照.json", protectionFile],
  ["参考资料/公共参数复用清单.json", reuseFile],
  ["参考资料/接口载荷样例.json", payloadFile],
].map(([relative, file]) => ({
  path: "hero39-root-entry-20260910/" + relative,
  sha256: shaFile(file),
  byteSize: fs.statSync(file).size,
}));
for (const heroId of Object.keys(heroes)) {
  sourceFiles.push({
    path: "hero39-root-entry-20260910/参考资料/客户端原文/" + heroId + ".json.gz",
    sha256: shaFile(path.join(INPUT, "参考资料", "客户端原文", heroId + ".json.gz")),
  });
  sourceFiles.push({
    path: "hero39-root-entry-20260910/参考资料/官方中文/" + heroId + ".json",
    sha256: shaFile(path.join(INPUT, "参考资料", "官方中文", heroId + ".json")),
  });
  sourceFiles.push({
    path: "hero39-root-entry-20260910/参考资料/官方英文/" + heroId + ".json",
    sha256: shaFile(path.join(INPUT, "参考资料", "官方英文", heroId + ".json")),
  });
}

const sourceBindingSha256 = shaFile(bindingFile);
const sourceRangeSha256 = shaFile(rangeDoc);
const cursorSupplementSha256 = shaFile(cursorSupplement);
const protectionSnapshotSha256 = shaFile(protectionFile);
const publicReuseSha256 = shaFile(reuseFile);
const inputVersionSha256 = shaFile(versionFile);

const candidate = {
  meta: {
    generatedAt: new Date().toISOString(),
    batch: BATCH,
    revision: REVISION,
    status: "候选已生成，等待主负责人审查；未调用业务接口",
    gameId: "lol",
    apiBase: API_BASE,
    sourceVersion: {
      clientVersion: binding.clientVersion,
      officialVersion: binding.officialVersion,
      build: inputVersion.clientBuild || "16.17.8104348+branch.releases-16-17.content.release",
    },
    sourcePolicy: "固定客户端16.17、官方16.17.1、当前绑定正文和计算树；明确值入候选，未知属性、曲线、事件时序和目标阶段用无默认运行输入或列为待核。",
    scope: "厄加特、莎弥拉、尼菈、斯莫德20个技能槽；唯一敌方英雄一对一。保留自身收益、同一敌人重复命中、强化技能和明确控制，排除额外目标、兵野专用和纯友方分支。",
    sourceBindingSha256,
    sourceRangeSha256,
    cursorSupplementSha256,
    sourceReview: {
      conclusionFile: ".agents/artifacts/hero39-cursor-review-run-20260910/Cursor来源复核结论.md",
      auditFile: ".agents/artifacts/hero39-cursor-review-run-20260910/主负责人执行审计.json",
      verdict: "READY",
      apiWrites: 0,
      note: "补充文档由主负责人在Cursor复核后核对，本候选只把它作为输入约束，不宣称补充文档由Cursor审查。",
    },
    inputPackage: ".agents/artifacts/hero39-root-entry-20260910",
    protectionSnapshotSha256,
    publicReuseSha256,
    inputVersionSha256,
    currentGETs: protection.GETs,
    apiCalls: 0,
    businessWrites: 0,
    noBusinessWrites: true,
    tokenStored: false,
    candidateSha256: null,
  },
  skills: definitions,
  order,
  reusedPublicParameters,
  reusedExistingParameters: clone(reusedPublicParameters),
  counts: {
    newParameters: order.reduce((total, key) => total + definitions[key].write.parameters.length, 0),
    newFormulas: order.reduce((total, key) => total + definitions[key].write.formulas.length, 0),
    newEffects: 0,
    newProcesses: 0,
    newInternalStates: 0,
    newTriggerRules: 0,
    newTotal: 0,
    reusedPublicParameters: reusedPublicParameters.length,
    plannedTotalIncludingReused: 0,
    protectedCurrentCompositionLists: protection.requests.filter(request => {
      const route = request.route || "";
      return route.endsWith("/parameters") ||
        route.endsWith("/formulas") ||
        route.endsWith("/effects") ||
        route.endsWith("/processes") ||
        route.endsWith("/internal-states") ||
        route.endsWith("/trigger-rules");
    }).length,
  },
  apiWrites: 0,
  sourceFiles,
  sourceNotes: {
    source: "当前绑定树与固定版本来源",
    sourceValues: "每个技能保留当前根DataValues、mSpellCalculations和双施法时间字段；只选择正文消费或范围内明确的值。",
    noDefault: "未知等级曲线、属性槽mStat8/9、实际暴击倍率、取整次数、生命池读取阶段和事件时点不设默认。",
    operation: "所有候选公式树均为二元ADD、SUBTRACT或MULTIPLY；无业务写入。",
    time: "所有写入的毫秒值先检查非负整数；冲突施法时间只在pending记录。",
    percentage: "正文中的百分数按百分数点或原始比例分别统一；mDisplayAsPercent不重复缩放。",
  },
  protectedObjects: {
    snapshotFile: "输入包/参考资料/当前20槽保护快照.json",
    snapshotSha256: protectionSnapshotSha256,
    requestCount: protection.requests.length,
    routes: protectedRouteHashes,
    note: "属性、4角色主体、4关系、20图片、挂载和120六类组成列表均只读保护；本批只计划新增组成和30个公共参数复用。",
  },
  revision: REVISION,
};
candidate.counts.newTotal =
  candidate.counts.newParameters +
  candidate.counts.newFormulas +
  candidate.counts.newEffects +
  candidate.counts.newProcesses +
  candidate.counts.newInternalStates +
  candidate.counts.newTriggerRules;
candidate.counts.plannedTotalIncludingReused =
  candidate.counts.newTotal + candidate.counts.reusedPublicParameters;

const candidateBytes = jsonBytes(candidate);
const candidateSha256 = sha256(candidateBytes);

const range = {
  generatedAt: candidate.meta.generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "第39批范围与来源选择；未调用业务接口",
  sourceBindingSha256,
  sourceRangeSha256,
  sourceReviewVerdict: "READY",
  skills: Object.fromEntries(order.map(skillKey => {
    const skill = definitions[skillKey];
    return [skillKey, {
      recordableParameters: skill.write.parameters.map(p => p.parameterKey),
      recordableFormulas: skill.write.formulas.map(f => f.formulaKey),
      excluded: clone(skill.excluded),
      pending: clone(skill.pending),
      currentSubjectProtected: skill.protectedExisting.subject,
    }];
  })),
  noApiCalls: true,
  apiWrites: 0,
};
const rangeBytes = jsonBytes(range);
const rangeSha256 = sha256(rangeBytes);

const requests = [];
for (const skillKey of order) {
  const write = definitions[skillKey].write;
  for (const [kind, identityKey] of [
    ["parameters", "parameterKey"],
    ["formulas", "formulaKey"],
    ["effects", "effectKey"],
    ["processes", "processKey"],
    ["internalStates", "stateKey"],
    ["triggerRules", "ruleKey"],
  ]) {
    for (const body of write[kind]) {
      const stableKey = body[identityKey];
      requests.push({
        sequence: requests.length + 1,
        operation: "POST",
        method: "POST",
        route: "/skills/" + skillKey + "/" + kind,
        detailRoute: "/skills/" + skillKey + "/" + kind + "/" + stableKey,
        skillKey,
        kind,
        stableKey,
        status: "仅意图，未调用",
        body: clone(body),
      });
    }
  }
}
if (requests.length !== candidate.counts.newTotal) {
  throw new Error("请求数量不符 " + requests.length + "/" + candidate.counts.newTotal);
}

const plan = {
  generatedAt: candidate.meta.generatedAt,
  status: "仅写入意图，未调用业务接口",
  batch: BATCH,
  revision: REVISION,
  apiBase: API_BASE,
  sourceVersion: clone(candidate.meta.sourceVersion),
  candidateSha256,
  sourceBindingSha256,
  sourceRangeSha256: rangeSha256,
  protectionSnapshotSha256,
  publicReuseSha256,
  requestCount: requests.length,
  counts: clone(candidate.counts),
  reusedPublicParameters: clone(reusedPublicParameters),
  protectedRoutes: protectedRouteHashes,
  protectedSummary: {
    inputGETs: protection.GETs,
    inputRequestCount: protection.requests.length,
    note: "写入前必须逐条GET保护路由，已存在非公共组成时整技能停止；本计划不覆盖现有组成。",
  },
  requests,
  noApiCalls: true,
  apiWrites: 0,
  businessWrites: 0,
};
const planBytes = jsonBytes(plan);
const planSha256 = sha256(planBytes);

const selectedValues = Object.fromEntries(order.map(skillKey => {
  const skill = definitions[skillKey];
  return [skillKey, {
    hero: skill.source.hero,
    slot: skill.source.slot,
    currentText: clone(skill.source.currentBoundText),
    rawDataValues: clone(skill.source.raw.dataValues),
    rawCalculations: clone(skill.source.raw.calculations),
    selectedParameterKeys: skill.write.parameters.map(p => p.parameterKey),
    selectedFormulaKeys: skill.write.formulas.map(f => f.formulaKey),
    sourceTextConsumers: currentTextEvidence(skillKey),
  }];
}));
const sourceValues = {
  generatedAt: candidate.meta.generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "独立来源值摘要；未调用业务接口",
  sourceBindingSha256,
  sourceValues: selectedValues,
  excludedSourceNames: {
    urgot_p: ["MonsterCap", "TriggerRange", "CastRange"],
    urgot_w: ["MinionMinimumDamage", "RangeCheck"],
    nilah_p: ["ExperiencePercentage", "HealDistance", "ShieldMaxDuration"],
    nilah_q: ["MinionMod", "MonsterMod", "CritDamageRatio"],
    smolder_q: ["Tier2_NumberOfBlowback", "Tier3_MonsterCap", "Tier3_TrueDamagePercent", "minionmod"],
    smolder_r: ["MinionMod", "SoundDistanceBehindSmolder", "SoundDistanceBehindSmolderSelfOnly", "LingeringSimmerSoundAmount", "LingeringSimmerSoundOffset", "LingeringSimmerSoundDebug", "MissileLandingSound", "VFXNorthAngleReplacement", "LingeringSimmerSoundDelay"],
  },
  noApiCalls: true,
  apiWrites: 0,
};
const sourceValuesBytes = jsonBytes(sourceValues);
const sourceValuesSha256 = sha256(sourceValuesBytes);

const candidateVersion = {
  generatedAt: candidate.meta.generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "候选冻结，待独立审查；未调用业务接口",
  candidateSha256,
  planSha256,
  rangeSha256,
  sourceValuesSha256,
  sourceBindingSha256,
  protectionSnapshotSha256,
  publicReuseSha256,
  counts: clone(candidate.counts),
  requestCount: requests.length,
  sourceMath: "独立数学核算.mjs",
  sourceMathStatus: "待执行",
  apiCalls: 0,
  businessWrites: 0,
  noBusinessWrites: true,
};
const hashes = {
  generatedAt: candidate.meta.generatedAt,
  batch: BATCH,
  revision: REVISION,
  files: {
    candidateSha256,
    planSha256,
    rangeSha256,
    sourceValuesSha256,
    sourceBindingSha256,
    protectionSnapshotSha256,
    publicReuseSha256,
  },
  inputFiles: sourceFiles,
  apiCalls: 0,
  businessWrites: 0,
};

const readme = [
  "# 第三十九批候选",
  "",
  "本目录保存厄加特、莎弥拉、尼菈、斯莫德20个技能槽的候选组成。来源固定客户端16.17、官方16.17.1、当前根绑定正文和计算树；Cursor来源复核结论为READY，但《Cursor复核后补充.md》由主负责人在复核后补充，候选只把它作为范围和数值输入。",
  "",
  "本候选只计划新增组成，公共冷却和法力参数按输入包的30项清单复用；主体、角色、关系、图片、挂载和现有六类组成全部只读保护。当前未调用业务接口，候选请求计划只表达待审写入意图。",
  "",
  "厄加特保留六腿单敌伤害、W正文消费的每发伤害、E护盾、R处决资格；莎弥拉保留评价、近战完整式、Q/R暴击、W两次同敌和E自身攻速；尼菈跳过P但保留Q/W/R自身收益、E两次充能和R四倍展示式；斯莫德保留层数战前输入、Q主命中暴击/灼烧/处决、W直击与英雄爆炸、E向下取整弹数原式和R中心替换/自身治疗。",
  "",
  "未知属性槽、等级中间曲线、事件时点、生命读取阶段和暴击实际倍率均无默认。所有写入的毫秒字段为非负整数；百分数点和原始比例按当前正文统一，mDisplayAsPercent不重复缩放。所有公式操作保持二元。",
  "",
].join("\n");
const experience = [
  "# 第三十九批候选体验记录",
  "",
  "四位英雄的20个技能槽均有根绑定、当前中文正文、官方中文/英文来源和当前主体保护快照。阅读候选时可先按英雄和技能查看正文消费的参数，再查看公式；排除项、待核项和来源原值分开列示。",
  "",
  "体验上的主要缺口是事件层尚未接入：厄加特逐腿触发与R处决资格、莎弥拉评价与暴击触发、尼菈Q/R的mStat输入和治疗阶段、斯莫德层数叠加与E弹数向下取整仍需要运行输入。候选没有用默认值把这些缺口伪装成已完成。",
  "",
  "本批未生成效果、过程或触发规则载荷，因为护盾、强化、治疗和冷却标志的应用阶段仍有事件或系统语义缺口；对应数值和完整公式已保存，后续接线应继续使用这些参数。",
  "",
].join("\n");

fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(DURABLE, { recursive: true });
writeNew(path.join(ROOT, "完整候选.json"), candidateBytes);
writeNew(path.join(ROOT, "请求计划.json"), planBytes);
writeNew(path.join(ROOT, "来源与范围.json"), rangeBytes);
writeNew(path.join(ROOT, "来源值摘要.json"), sourceValuesBytes);
writeJsonNew(path.join(ROOT, "候选版本.json"), candidateVersion);
writeJsonNew(path.join(ROOT, "来源哈希汇总.json"), hashes);
writeNew(path.join(ROOT, "README.md"), Buffer.from(readme, "utf8"));
writeNew(path.join(ROOT, "体验报告.md"), Buffer.from(experience, "utf8"));
writeJsonNew(path.join(ROOT, "文件散列.json"), {
  candidateSha256,
  planSha256,
  rangeSha256,
  sourceValuesSha256,
  sourceBindingSha256,
  protectionSnapshotSha256,
  publicReuseSha256,
  generatedAt: candidate.meta.generatedAt,
});
for (const relative of [
  "完整候选.json",
  "请求计划.json",
  "来源与范围.json",
  "来源值摘要.json",
  "候选版本.json",
  "来源哈希汇总.json",
  "README.md",
  "体验报告.md",
  "文件散列.json",
]) {
  writeNew(path.join(DURABLE, relative), fs.readFileSync(path.join(ROOT, relative)));
}
writeJsonNew(path.join(ROOT, "来源冻结通知.json"), {
  batch: BATCH,
  revision: REVISION,
  candidateSha256,
  planSha256,
  rangeSha256,
  sourceValuesSha256,
  counts: candidate.counts,
  requestCount: requests.length,
  apiCalls: 0,
  businessWrites: 0,
  status: "冻结候选，等待主负责人审查；未调用业务接口",
});

console.log(JSON.stringify({
  revision: REVISION,
  candidateSha256,
  planSha256,
  rangeSha256,
  sourceValuesSha256,
  counts: candidate.counts,
  requestCount: requests.length,
  reusedPublicParameters: reusedPublicParameters.length,
  apiCalls: 0,
  businessWrites: 0,
  durable: DURABLE,
}, null, 2));
