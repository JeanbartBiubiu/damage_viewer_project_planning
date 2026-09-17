import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_FILE = path.join(ROOT, "完整候选.json");
const INPUT = path.resolve(ROOT, "..", "hero48-root-entry-20260910");
const DURABLE = path.resolve("数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十八批");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const round = value => Number(Number(value).toFixed(9));
const norm = value => round(value);
const equal = (left, right) => Math.abs(Number(left) - Number(right)) <= 1e-6 * Math.max(1, Math.abs(Number(left)), Math.abs(Number(right)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const need = (object, key, label) => {
  if (!object || !Object.prototype.hasOwnProperty.call(object, key) || object[key] === null || object[key] === undefined) throw new Error(`缺少${label}`);
  return object[key];
};
const toMs = seconds => {
  const raw = Number(seconds);
  const milliseconds = raw * 1000;
  const rounded = Math.round(milliseconds);
  assert(Number.isFinite(raw) && raw >= 0 && Math.abs(milliseconds - rounded) <= 1e-3, `时间不是可精确换算的整数毫秒：${seconds}`);
  return rounded;
};

const candidate = readJson(CANDIDATE_FILE);
const bindingFile = path.join(INPUT, "来源绑定与当前文本.json");
const protectionFile = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const inputVersionFile = path.join(INPUT, "输入版本.json");
const dynamicFile = path.join(INPUT, "凯隐动态正文补充.json");
const rangeFile = path.join(INPUT, "主负责人范围与核对要求.md");
const sourceNoteFile = path.join(INPUT, "主负责人源值核对说明.md");
const qualificationFile = path.join(INPUT, "资格补证.md");
const cursorAuditFile = path.resolve(ROOT, "..", "hero48-cursor-review-run-20260910", "主负责人执行审计.json");
const cursorSummaryFile = path.resolve(ROOT, "..", "hero48-cursor-review-run-20260910", "summary.json");
const cursorConclusionFile = path.resolve(ROOT, "..", "hero48-cursor-review-run-20260910", "Cursor来源复核结论.md");
for (const file of [bindingFile, protectionFile, reuseFile, inputVersionFile, dynamicFile, rangeFile, sourceNoteFile, qualificationFile, cursorAuditFile, cursorSummaryFile, cursorConclusionFile]) assert(fs.existsSync(file), `缺少冻结输入：${file}`);
const binding = readJson(bindingFile);
const protection = readJson(protectionFile);
const reuseList = readJson(reuseFile);
const inputVersion = readJson(inputVersionFile);
const dynamic = readJson(dynamicFile);
const cursorAudit = readJson(cursorAuditFile);
const cursorSummary = readJson(cursorSummaryFile);
const cursorConclusion = fs.readFileSync(cursorConclusionFile, "utf8");
const qualificationText = fs.readFileSync(qualificationFile, "utf8");
const dynamicByKey = Object.fromEntries((dynamic.entries || []).map(item => [item.key, item.text]));
const dynamicKeyBySlot = { P: "game_spell_kayn_p_main_0", Q: "game_spell_kayn_q_main_0", W: "game_spell_kayn_w_maintext_0", E: "game_spell_kayn_e_main_0", R: "spell_kayn_r_main_0" };
const protectedByRoute = new Map((protection.requests || []).map(request => [request.route, request]));
const attributesRoute = protectedByRoute.get("/attributes");
assert(attributesRoute?.status === 200 && Array.isArray(attributesRoute.data?.items), "冻结属性快照缺少/attributes");
const frozenAttributeItems = attributesRoute.data.items;
const frozenAttributeKeys = new Set(frozenAttributeItems.map(item => item.attributeKey));
assert(frozenAttributeKeys.size === frozenAttributeItems.length && frozenAttributeKeys.size > 0, "冻结属性快照存在重复或空属性键");
const sourceSkills = Object.fromEntries(binding.heroes.map(hero => [hero.id, Object.fromEntries(hero.skills.map(skill => [skill.slot, skill]))]));
const spell = (heroId, slot) => sourceSkills[heroId]?.[slot]?.object?.mSpell;
const dataRow = (heroId, slot, name) => {
  const row = (spell(heroId, slot)?.DataValues || []).find(item => item.name === name);
  assert(row && Array.isArray(row.values), `缺少源DataValue：${heroId}/${slot}/${name}`);
  return row.values;
};
const dataAt = (heroId, slot, name, index = 1) => {
  const value = dataRow(heroId, slot, name)[index];
  assert(typeof value === "number" && Number.isFinite(value), `源DataValue不是有限数字：${heroId}/${slot}/${name}/${index}`);
  return value;
};
const fieldAt = (heroId, slot, name, index = 1) => {
  const value = spell(heroId, slot)?.[name];
  if (Array.isArray(value)) {
    assert(typeof value[index] === "number" && Number.isFinite(value[index]), `缺少源字段数组值：${heroId}/${slot}/${name}/${index}`);
    return value[index];
  }
  assert(typeof value === "number" && Number.isFinite(value), `缺少源字段数字值：${heroId}/${slot}/${name}`);
  return value;
};
const calc = (heroId, slot, name) => {
  const value = (spell(heroId, slot)?.mSpellCalculations || {})[name];
  assert(value, `缺少源计算树：${heroId}/${slot}/${name}`);
  return value;
};
const calcPart = (heroId, slot, name, index = 0) => {
  const part = (calc(heroId, slot, name).mFormulaParts || [])[index];
  assert(part, `缺少源计算树分支：${heroId}/${slot}/${name}/${index}`);
  return part;
};
const calcCoefficient = (heroId, slot, name, index = 1) => {
  const value = calcPart(heroId, slot, name, index).mCoefficient;
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树系数：${heroId}/${slot}/${name}/${index}`);
  return value;
};
const calcMultiplier = (heroId, slot, name) => {
  const value = calc(heroId, slot, name).mMultiplier?.mNumber;
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树固定倍率：${heroId}/${slot}/${name}`);
  return value;
};
const nestedNumber = (object, keys, label) => {
  let value = object;
  for (const key of keys) value = value?.[key];
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树数值：${label}`);
  return value;
};
const skillKeyOf = (heroId, slot) => `${heroId.toLowerCase()}_${slot.toLowerCase()}`;
const maxLevelOf = skillKey => {
  const hit = protectedByRoute.get(`/skills/${skillKey}`);
  assert(hit?.status === 200 && Number.isInteger(hit.data.maxLevel), `缺少受保护最高等级：${skillKey}`);
  return hit.data.maxLevel;
};

assert(candidate.order?.length === 20 && candidate.order.every(key => candidate.skills?.[key]), "候选不是完整20槽");
assert(inputVersion.GETs === 193 && inputVersion.reusedParameters === 21 && inputVersion.apiWrites === 0, "冻结输入计数或写入状态不符");
assert(binding.clientVersion === "16.17" && binding.officialVersion === "16.17.1", "来源版本不符");
assert(candidate.counts.newParameters === 137 && candidate.counts.newFormulas === 24 && candidate.counts.newEffects === 34 && candidate.counts.newTotal === 195, "候选计数不符");
assert(shaFile(dynamicFile) === "1950eb1d4b7903862cfb66fb16d290e40cb35ba8a6da9a9150726f446a7a6142", "凯隐动态正文散列不符");
assert(dynamic.sourceSha256 === (inputVersion.sourceFiles || []).find(item => item.path.endsWith("lol-16.17-zh_CN.stringtable.json.gz"))?.sha256, "凯隐动态正文来源散列不符");
assert(cursorAudit.readonlyAuditPassed === true && cursorAudit.resultStatus === "finished" && cursorAudit.events === 4485 && cursorAudit.uniqueTools === 74 && cursorAudit.inputsChecked === 26 && cursorAudit.apiWrites === 0, "Cursor实际复核审计不符");
assert((Array.isArray(cursorAudit.gitDelta) ? cursorAudit.gitDelta.length : Number(cursorAudit.gitDelta || 0)) === 0, "Cursor审计存在Git变化");
assert(cursorAudit.reviewedPlanRev === "hero48-source-v1" && cursorSummary.resultStatus === "finished" && /READY/.test(cursorSummary.assistantText || "") && /READY/.test(cursorConclusion), "Cursor复核没有READY结论");

const publicData = new Map();
for (const item of reuseList) {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const hit = protectedByRoute.get(route);
  assert(hit?.status === 200, `公共参数保护缺失：${route}`);
  publicData.set(`${item.skillKey}/${item.parameterKey}`, clone(hit.data));
}
const parameterOf = (skillKey, parameterKey) => candidate.skills[skillKey]?.write.parameters.find(item => item.parameterKey === parameterKey);
const parameterMap = (skillKey, skillLevel, characterLevel, inputs = {}) => {
  const values = {};
  for (const parameter of candidate.skills[skillKey].write.parameters) {
    if (parameter.valueMode === "FIXED") values[parameter.parameterKey] = need(parameter, "fixedValue", `固定参数${skillKey}/${parameter.parameterKey}`);
    else if (parameter.valueMode === "SKILL_LEVEL") values[parameter.parameterKey] = need(parameter.levelValues, String(skillLevel), `技能等级参数${skillKey}/${parameter.parameterKey}/${skillLevel}`);
    else if (parameter.valueMode === "CHARACTER_LEVEL") values[parameter.parameterKey] = need(parameter.levelValues, String(characterLevel), `角色等级参数${skillKey}/${parameter.parameterKey}/${characterLevel}`);
    else if (parameter.valueMode === "RUNTIME_INPUT") values[parameter.parameterKey] = need(inputs, parameter.parameterKey, `运行输入${skillKey}/${parameter.parameterKey}`);
    else throw new Error(`未知参数模式：${skillKey}/${parameter.parameterKey}`);
  }
  for (const item of reuseList.filter(item => item.skillKey === skillKey)) {
    const data = publicData.get(`${item.skillKey}/${item.parameterKey}`);
    assert(data, `缺少公共参数：${skillKey}/${item.parameterKey}`);
    values[item.parameterKey] = data.valueMode === "FIXED" ? data.fixedValue : data.levelValues?.[String(skillLevel)];
    assert(typeof values[item.parameterKey] === "number" && Number.isFinite(values[item.parameterKey]), `公共参数无当前等级值：${skillKey}/${item.parameterKey}`);
  }
  return values;
};
const attrsFor = scenario => ({
  SOURCE: {
    attack_damage: { TOTAL: scenario.totalAD, BONUS: scenario.bonusAD },
    ability_power: { TOTAL: scenario.AP },
    hp: { TOTAL: scenario.sourceMaxHP, CURRENT: scenario.sourceCurrentHP, MISSING: scenario.sourceMissingHP, BONUS: scenario.sourceBonusHP },
  },
  TARGET: { hp: { TOTAL: scenario.targetMaxHP, CURRENT: scenario.targetCurrentHP, MISSING: scenario.targetMissingHP } },
});
const allowedAttributes = new Set([
  "SOURCE/attack_damage/TOTAL", "SOURCE/attack_damage/BONUS", "SOURCE/ability_power/TOTAL",
  "SOURCE/hp/TOTAL", "SOURCE/hp/CURRENT", "SOURCE/hp/MISSING", "SOURCE/hp/BONUS",
  "TARGET/hp/TOTAL", "TARGET/hp/CURRENT", "TARGET/hp/MISSING",
]);
const evaluate = (node, params, attrs) => {
  if (!node || typeof node !== "object") throw new Error("公式节点为空");
  if (node.nodeType === "PARAMETER") return need(params, node.parameterKey, `公式参数${node.parameterKey}`);
  if (node.nodeType === "ATTRIBUTE") {
    const key = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`;
    if (!allowedAttributes.has(key)) throw new Error(`属性枚举未证：${key}`);
    const value = attrs[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`缺少属性${key}`);
    return value;
  }
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error("操作数不是恰好两个");
    const [left, right] = node.operands.map(child => evaluate(child, params, attrs));
    let result;
    if (node.operation === "ADD") result = left + right;
    else if (node.operation === "SUBTRACT") result = left - right;
    else if (node.operation === "MULTIPLY") result = left * right;
    else if (node.operation === "DIVIDE") result = left / right;
    else throw new Error(`未知二元运算：${node.operation}`);
    assert(Number.isFinite(result), `公式结果不是有限数字：${result}`);
    return result;
  }
  throw new Error(`未知节点：${node.nodeType}`);
};
const walk = (node, callback) => {
  if (!node || typeof node !== "object") return;
  callback(node);
  if (Array.isArray(node.operands)) node.operands.forEach(child => walk(child, callback));
};
const refsOf = expression => {
  const refs = [];
  walk(expression, node => { if (node.nodeType === "PARAMETER") refs.push(node.parameterKey); });
  return [...new Set(refs)];
};
const runtimeRefsOfEffect = effect => {
  const refs = [];
  const duration = effect.lifecycle?.durationValue;
  if (duration?.kind === "PARAMETER") refs.push(duration.parameterKey);
  for (const result of effect.results || []) if (result.valueRule?.value?.kind === "PARAMETER") refs.push(result.valueRule.value.parameterKey);
  return [...new Set(refs)];
};
const scenarioFor = (skillKey, index) => ({
  skillKey,
  rank: candidate.skills[skillKey].maxLevel > 1 ? (index === 0 ? 1 : candidate.skills[skillKey].maxLevel) : 1,
  characterLevel: index === 0 ? 1 : 18,
  totalAD: index === 0 ? 220 : 420,
  bonusAD: index === 0 ? 100 : 240,
  AP: index === 0 ? 130 : 480,
  sourceMaxHP: index === 0 ? 2600 : 3800,
  sourceCurrentHP: index === 0 ? 1700 : 2400,
  sourceMissingHP: index === 0 ? 900 : 1400,
  sourceBonusHP: index === 0 ? 600 : 1400,
  targetMaxHP: index === 0 ? 1400 : 2600,
  targetCurrentHP: index === 0 ? 700 : 1500,
  targetMissingHP: index === 0 ? 700 : 1100,
  inputs: {
    q_heal_base_actual: index === 0 ? 10 : 68,
    active_mstat8: index === 0 ? 1 : 1,
    active_mstat9: index === 0 ? 1.5 : 1.8,
    on_hit_crit_mstat9: index === 0 ? 1.5 : 1.8,
    second_attack_current_hp: index === 0 ? 550 : 1120,
    qualified_actual_damage_for_heal: index === 0 ? 100 : 260,
    charge_duration_ms: index === 0 ? 500 : 2500,
    mstat8_actual: index === 0 ? 1 : 1,
    mstat9_actual: index === 0 ? 1.5 : 1.8,
  },
});
const sourceDynamicDoubleHit = /再次造成等额伤害/.test(dynamicByKey[dynamicKeyBySlot.Q] || "") ? 2 : (() => { throw new Error("凯隐Q动态正文未证明双段等额"); })();
const expected = (skillKey, formulaKey, scenario) => {
  const { rank, AP, bonusAD, totalAD, sourceMaxHP, targetMaxHP, targetCurrentHP, targetMissingHP, inputs } = scenario;
  const dv = (heroId, slot, name, index = rank) => dataAt(heroId, slot, name, index);
  switch (`${skillKey}/${formulaKey}`) {
    case "ivern_q/magic_damage": return dv("Ivern", "Q", "BaseDamage") + dv("Ivern", "Q", "APRatio") * AP;
    case "ivern_q/root_duration": return toMs(dv("Ivern", "Q", "RootDuration"));
    case "ivern_w/magic_damage": return dv("Ivern", "W", "BaseDamage") + calcCoefficient("Ivern", "W", "TotalDamage") * AP;
    case "ivern_e/shield": return dv("Ivern", "E", "BaseShield") + dv("Ivern", "E", "ShieldAPRatio") * AP;
    case "ivern_e/magic_damage": return dv("Ivern", "E", "BaseDamage") + dv("Ivern", "E", "DamageAPRatio") * AP;
    case "yorick_q/bonus_damage": return dv("Yorick", "Q", "BaseDamage") + dv("Yorick", "Q", "BonusDamageAD") * totalAD;
    case "yorick_q/self_heal": return need(inputs, "q_heal_base_actual", "约里克Q实际基础治疗") + dv("Yorick", "Q", "MissingHealthRatio") * 0.01 * scenario.sourceMissingHP;
    case "yorick_e/max_health_magic_damage": return calcMultiplier("Yorick", "E", "Calc_HealthDamage") * (dv("Yorick", "E", "HealthDamage") + dv("Yorick", "E", "HealthAPRatio") * AP) * targetMaxHP;
    case "yorick_r/marked_target_magic_damage": return 0.01 * dv("Yorick", "R", "RMarkDamagePercent") * targetMaxHP;
    case "kayn_q/single_physical_damage": return dv("Kayn", "Q", "BaseDamage") + dv("Kayn", "Q", "BonusADRatio") * bonusAD;
    case "kayn_q/double_physical_damage": return (dv("Kayn", "Q", "BaseDamage") + dv("Kayn", "Q", "BonusADRatio") * bonusAD) * sourceDynamicDoubleHit;
    case "kayn_w/physical_damage": return dv("Kayn", "W", "BaseDamage") + calcCoefficient("Kayn", "W", "TotalDamage") * bonusAD;
    case "kayn_e/self_healing": return dv("Kayn", "E", "HealAmount") + calcCoefficient("Kayn", "E", "TotalHealing") * bonusAD;
    case "kayn_r/physical_damage": return dv("Kayn", "R", "BaseDamage") + calcCoefficient("Kayn", "R", "Damage") * bonusAD;
    case "viego_q/active_physical_damage": return (dv("Viego", "Q", "Damage") + dv("Viego", "Q", "ActiveADRatio") * totalAD) * (nestedNumber(calc("Viego", "Q", "TotalDamage"), ["mMultiplier", "mSubparts", 0, "mNumber"], "佛耶戈Q主动固定基准") + dv("Viego", "Q", "ActiveCritMod") * inputs.active_mstat8 * (inputs.active_mstat9 - 1));
    case "viego_q/on_hit_current_health_damage": return nestedNumber(calc("Viego", "Q", "TotalPercentHealthOnHit"), ["mMultiplier", "mNumber"], "佛耶戈Q当前生命百分数转换") * dv("Viego", "Q", "PercentHealthOnHit") * targetCurrentHP;
    case "viego_q/critical_on_hit_current_health_damage": return nestedNumber(calc("Viego", "Q", "HealthCritDamage"), ["mMultiplier", "mPart1", "mNumber"], "佛耶戈Q暴击百分数转换") * dv("Viego", "Q", "PercentHealthOnHit") * (1 + dv("Viego", "Q", "HealthCritMod") * (inputs.on_hit_crit_mstat9 - 1)) * inputs.second_attack_current_hp;
    case "viego_q/second_attack_physical_damage": return calcCoefficient("Viego", "Q", "SecondAttackDamage", 0) * totalAD + dv("Viego", "Q", "SecondAttackAPRatio") * AP;
    case "viego_q/second_attack_heal": return inputs.qualified_actual_damage_for_heal * dv("Viego", "Q", "HealModVsChamps");
    case "viego_w/magic_damage": return dv("Viego", "W", "Damage") + dv("Viego", "W", "APRatio") * AP;
    case "viego_e/total_move_speed": return dv("Viego", "E", "MoveSpeed") + dv("Viego", "E", "MSAPRatio") * AP;
    case "viego_r/base_physical_damage": return dv("Viego", "R", "ADRatio") * totalAD * (1 + dv("Viego", "R", "CritMod") * inputs.mstat8_actual * (inputs.mstat9_actual - 1));
    case "viego_r/missing_health_physical_damage": return 0.01 * (dv("Viego", "R", "MaxHealthDamage") + calcCoefficient("Viego", "R", "TotalPercentHealth") * bonusAD) * targetMissingHP;
    case "viego_r/physical_damage": return dv("Viego", "R", "ADRatio") * totalAD * (1 + dv("Viego", "R", "CritMod") * inputs.mstat8_actual * (inputs.mstat9_actual - 1)) + 0.01 * (dv("Viego", "R", "MaxHealthDamage") + calcCoefficient("Viego", "R", "TotalPercentHealth") * bonusAD) * targetMissingHP;
    default: throw new Error(`缺少独立期望侧映射：${skillKey}/${formulaKey}`);
  }
};

const expectedParameter = new Map();
const sourceArraySpecs = [];
const sourceFixedIndexSpecs = [];
const mapSkill = (skillKey, parameterKey, heroId, slot, dataName, count, transform = value => value, start = 1) => {
  const values = Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index + 1), norm(transform(dataAt(heroId, slot, dataName, start + index)))]));
  expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "SKILL_LEVEL", values });
  sourceArraySpecs.push({ skillKey, parameterKey, heroId, slot, dataName, start, count, transform });
};
const mapDataFixed = (skillKey, parameterKey, heroId, slot, dataName, transform = value => value, index = 1) => {
  const value = norm(transform(dataAt(heroId, slot, dataName, index)));
  expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "FIXED", value });
  sourceFixedIndexSpecs.push({ skillKey, parameterKey, sourceKind: "DataValue", heroId, slot, name: dataName, index, transform, expected: value });
};
const mapFieldFixed = (skillKey, parameterKey, heroId, slot, fieldName, transform = value => value, index = 1) => {
  const value = norm(transform(fieldAt(heroId, slot, fieldName, index)));
  expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "FIXED", value });
  sourceFixedIndexSpecs.push({ skillKey, parameterKey, sourceKind: "field", heroId, slot, name: fieldName, index, transform, expected: value });
};
const mapFixed = (skillKey, parameterKey, value) => expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "FIXED", value: norm(value) });
const mapRuntime = (skillKey, parameterKey) => expectedParameter.set(`${skillKey}/${parameterKey}`, { mode: "RUNTIME_INPUT" });
const mapCoefficient = (skillKey, parameterKey, heroId, slot, calculationName, index = 1) => mapFixed(skillKey, parameterKey, calcCoefficient(heroId, slot, calculationName, index));
const mapMultiplier = (skillKey, parameterKey, heroId, slot, calculationName) => mapFixed(skillKey, parameterKey, calcMultiplier(heroId, slot, calculationName));

mapSkill("ivern_q", "base_damage", "Ivern", "Q", "BaseDamage", 5);
mapSkill("ivern_q", "root_duration_ms", "Ivern", "Q", "RootDuration", 5, toMs);
mapDataFixed("ivern_q", "ap_ratio", "Ivern", "Q", "APRatio");
mapDataFixed("ivern_q", "dash_speed", "Ivern", "Q", "DashSpeed");
mapFieldFixed("ivern_q", "m_cast_time_ms", "Ivern", "Q", "mCastTime", toMs);
mapFieldFixed("ivern_q", "spell_cast_time_ms", "Ivern", "Q", "spellCastTime", toMs);
mapFieldFixed("ivern_q", "cast_range", "Ivern", "Q", "castRange");
mapFieldFixed("ivern_q", "display_range", "Ivern", "Q", "castRangeDisplayOverride");
mapFieldFixed("ivern_q", "cast_radius", "Ivern", "Q", "castRadius");
mapFieldFixed("ivern_q", "missile_speed", "Ivern", "Q", "missileSpeed");
mapSkill("ivern_w", "base_damage", "Ivern", "W", "BaseDamage", 5);
mapDataFixed("ivern_w", "buff_duration_ms", "Ivern", "W", "BuffDuration", toMs);
mapDataFixed("ivern_w", "reveal_duration_ms", "Ivern", "W", "RevealDuration", toMs);
mapDataFixed("ivern_w", "max_brush_duration_ms", "Ivern", "W", "MaxBrushDuration", toMs);
mapDataFixed("ivern_w", "brush_radius", "Ivern", "W", "BrushRadius");
mapDataFixed("ivern_w", "brush_spacing", "Ivern", "W", "BrushSpacing");
mapFieldFixed("ivern_w", "max_ammo", "Ivern", "W", "mMaxAmmo");
mapFieldFixed("ivern_w", "ammo_recharge_ms", "Ivern", "W", "mAmmoRechargeTime", toMs);
mapFieldFixed("ivern_w", "cooldown_interval_ms", "Ivern", "W", "cooldownTime", toMs);
mapFieldFixed("ivern_w", "spell_cast_time_ms", "Ivern", "W", "spellCastTime", toMs);
mapFieldFixed("ivern_w", "cast_range", "Ivern", "W", "castRange");
mapFieldFixed("ivern_w", "display_range", "Ivern", "W", "castRangeDisplayOverride");
mapFieldFixed("ivern_w", "missile_speed", "Ivern", "W", "missileSpeed");
mapCoefficient("ivern_w", "ap_ratio", "Ivern", "W", "TotalDamage");
mapSkill("ivern_e", "base_shield", "Ivern", "E", "BaseShield", 5);
mapDataFixed("ivern_e", "shield_ap_ratio", "Ivern", "E", "ShieldAPRatio");
mapSkill("ivern_e", "base_damage", "Ivern", "E", "BaseDamage", 5);
mapDataFixed("ivern_e", "damage_ap_ratio", "Ivern", "E", "DamageAPRatio");
mapSkill("ivern_e", "slow_ratio", "Ivern", "E", "SlowAmount", 5);
mapDataFixed("ivern_e", "slow_duration_ms", "Ivern", "E", "SlowDuration", toMs);
mapDataFixed("ivern_e", "shield_duration_ms", "Ivern", "E", "ShieldDuration", toMs);
mapFieldFixed("ivern_e", "cast_range", "Ivern", "E", "castRange");
mapFieldFixed("ivern_e", "missile_speed", "Ivern", "E", "missileSpeed");

mapSkill("yorick_q", "base_damage", "Yorick", "Q", "BaseDamage", 5);
mapSkill("yorick_q", "missing_health_percent_points", "Yorick", "Q", "MissingHealthRatio", 5);
mapDataFixed("yorick_q", "total_ad_ratio", "Yorick", "Q", "BonusDamageAD");
mapDataFixed("yorick_q", "buff_duration_ms", "Yorick", "Q", "BuffDuration", toMs);
mapFixed("yorick_q", "percent_point_ratio", 0.01);
mapRuntime("yorick_q", "q_heal_base_actual");
mapSkill("yorick_e", "health_damage_percent_points", "Yorick", "E", "HealthDamage", 5);
mapDataFixed("yorick_e", "health_ap_ratio", "Yorick", "E", "HealthAPRatio");
mapMultiplier("yorick_e", "percent_point_ratio", "Yorick", "E", "Calc_HealthDamage");
mapSkill("yorick_e", "slow_ratio", "Yorick", "E", "SlowAmount", 5);
mapDataFixed("yorick_e", "slow_duration_ms", "Yorick", "E", "SlowDuration", toMs);
mapDataFixed("yorick_e", "mark_duration_ms", "Yorick", "E", "MarkDuration", toMs);
mapDataFixed("yorick_e", "mark_range", "Yorick", "E", "MarkRange");
mapSkill("yorick_e", "armor_shred_ratio", "Yorick", "E", "ArmorShred", 5);
mapSkill("yorick_e", "move_speed_ratio", "Yorick", "E", "HasteAmount", 5);
mapFieldFixed("yorick_e", "cast_range", "Yorick", "E", "castRange");
mapFieldFixed("yorick_e", "spell_cast_time_ms", "Yorick", "E", "spellCastTime", toMs);
mapSkill("yorick_r", "r_mark_damage_percent_points", "Yorick", "R", "RMarkDamagePercent", 3);
mapFixed("yorick_r", "percent_point_ratio", 0.01);
mapFieldFixed("yorick_r", "cast_range", "Yorick", "R", "castRange");

mapSkill("kayn_q", "base_damage", "Kayn", "Q", "BaseDamage", 5);
mapDataFixed("kayn_q", "bonus_ad_ratio", "Kayn", "Q", "BonusADRatio");
mapDataFixed("kayn_q", "aoe_radius", "Kayn", "Q", "AoERadius");
mapFixed("kayn_q", "double_hit_multiplier", sourceDynamicDoubleHit);
mapFieldFixed("kayn_q", "cast_time_ms", "Kayn", "Q", "mCastTime", toMs);
mapFieldFixed("kayn_q", "display_range", "Kayn", "Q", "castRangeDisplayOverride");
mapSkill("kayn_w", "base_damage", "Kayn", "W", "BaseDamage", 5);
mapDataFixed("kayn_w", "slow_ratio", "Kayn", "W", "SlowIntensity", value => Math.abs(Number(value)));
mapDataFixed("kayn_w", "slow_duration_ms", "Kayn", "W", "SlowDuration", toMs);
mapDataFixed("kayn_w", "box_width", "Kayn", "W", "BoxWidth");
mapDataFixed("kayn_w", "display_range", "Kayn", "W", "AssRange");
mapFieldFixed("kayn_w", "cast_time_ms", "Kayn", "W", "mCastTime", toMs);
mapFieldFixed("kayn_w", "cast_range", "Kayn", "W", "castRange");
mapCoefficient("kayn_w", "bonus_ad_ratio", "Kayn", "W", "TotalDamage");
mapSkill("kayn_e", "wall_walk_duration_ms", "Kayn", "E", "WallWalkDuration", 5, toMs);
mapDataFixed("kayn_e", "move_speed_ratio", "Kayn", "E", "MS", value => Number(value) / 100);
mapDataFixed("kayn_e", "out_of_terrain_end_ms", "Kayn", "E", "LingerTime", toMs);
mapDataFixed("kayn_e", "max_in_combat_ms", "Kayn", "E", "MaxInCombatTime", toMs);
mapSkill("kayn_e", "heal_base", "Kayn", "E", "HealAmount", 5);
mapCoefficient("kayn_e", "heal_bonus_ad_ratio", "Kayn", "E", "TotalHealing");
mapSkill("kayn_r", "base_damage", "Kayn", "R", "BaseDamage", 3);
mapCoefficient("kayn_r", "bonus_ad_ratio", "Kayn", "R", "Damage");
mapDataFixed("kayn_r", "minimum_infest_ms", "Kayn", "R", "MinimumInfestTime", toMs);
mapDataFixed("kayn_r", "max_infest_ms", "Kayn", "R", "InfestDuration", toMs);
mapDataFixed("kayn_r", "jump_out_distance", "Kayn", "R", "JumpOutDistance");
mapDataFixed("kayn_r", "base_cast_range", "Kayn", "R", "BaseCastRange");
mapFixed("kayn_r", "mark_duration_ms", toMs(3.15));
mapFieldFixed("kayn_r", "cast_time_ms", "Kayn", "R", "mCastTime", toMs);

mapSkill("viego_q", "active_base_damage", "Viego", "Q", "Damage", 5);
mapDataFixed("viego_q", "active_ad_ratio", "Viego", "Q", "ActiveADRatio");
mapDataFixed("viego_q", "active_crit_ratio", "Viego", "Q", "ActiveCritMod");
mapSkill("viego_q", "on_hit_current_health_percent_points", "Viego", "Q", "PercentHealthOnHit", 5);
mapSkill("viego_q", "on_hit_min_damage", "Viego", "Q", "MinDamageOnHit", 5);
mapDataFixed("viego_q", "mark_duration_ms", "Viego", "Q", "MarkDuration", toMs);
mapDataFixed("viego_q", "health_crit_ratio", "Viego", "Q", "HealthCritMod");
mapDataFixed("viego_q", "second_attack_ap_ratio", "Viego", "Q", "SecondAttackAPRatio");
mapCoefficient("viego_q", "second_attack_total_ad_ratio", "Viego", "Q", "SecondAttackDamage", 0);
mapFixed("viego_q", "percent_point_ratio", nestedNumber(calc("Viego", "Q", "TotalPercentHealthOnHit"), ["mMultiplier", "mNumber"], "佛耶戈Q百分数转换"));
mapFixed("viego_q", "crit_base_multiplier", nestedNumber(calc("Viego", "Q", "TotalDamage"), ["mMultiplier", "mSubparts", 0, "mNumber"], "佛耶戈Q暴击基准"));
mapFixed("viego_q", "crit_subtract_one", nestedNumber(calc("Viego", "Q", "TotalDamage"), ["mMultiplier", "mSubparts", 1, "mPart2", "mSubparts", 1, "mNumber"], "佛耶戈Q暴击减一"));
mapRuntime("viego_q", "active_mstat8");
mapRuntime("viego_q", "active_mstat9");
mapRuntime("viego_q", "on_hit_crit_mstat9");
mapRuntime("viego_q", "second_attack_current_hp");
mapRuntime("viego_q", "qualified_actual_damage_for_heal");
mapDataFixed("viego_q", "heal_mod_vs_champs", "Viego", "Q", "HealModVsChamps");
mapFieldFixed("viego_q", "cast_time_ms", "Viego", "Q", "mCastTime", toMs);
mapFieldFixed("viego_q", "cast_range", "Viego", "Q", "castRange");
mapDataFixed("viego_q", "rectangle_width", "Viego", "Q", "RectangleWidth");
mapSkill("viego_w", "base_damage", "Viego", "W", "Damage", 5);
mapDataFixed("viego_w", "ap_ratio", "Viego", "W", "APRatio");
mapDataFixed("viego_w", "min_stun_duration_ms", "Viego", "W", "StunDuration", toMs);
mapDataFixed("viego_w", "max_stun_duration_ms", "Viego", "W", "MaxStunTT", toMs);
mapSkill("viego_w", "self_slow_ratio", "Viego", "W", "SelfSlowPercent", 5);
mapSkill("viego_w", "max_charge_time_ms", "Viego", "W", "MaxChargeTime", 5, toMs);
mapFieldFixed("viego_w", "channel_duration_ms", "Viego", "W", "mChannelDuration", toMs);
mapDataFixed("viego_w", "interrupted_cooldown_ms", "Viego", "W", "CDWheninterrupted", toMs);
mapDataFixed("viego_w", "dash_distance", "Viego", "W", "DashDistance");
mapDataFixed("viego_w", "dash_speed", "Viego", "W", "DashSpeed");
mapDataFixed("viego_w", "min_missile_range", "Viego", "W", "MinMissileRange");
mapDataFixed("viego_w", "max_bonus_missile_range", "Viego", "W", "MaxBonusMissileRange");
mapRuntime("viego_w", "charge_duration_ms");
mapFieldFixed("viego_w", "spell_cast_time_ms", "Viego", "W", "spellCastTime", toMs, 0);
mapSkill("viego_e", "mist_duration_ms", "Viego", "E", "MistDuration", 5, toMs);
mapSkill("viego_e", "move_speed_ratio", "Viego", "E", "MoveSpeed", 5);
mapSkill("viego_e", "attack_speed_ratio", "Viego", "E", "AttackSpeed", 5);
mapDataFixed("viego_e", "camo_radius", "Viego", "E", "CamoRadius");
mapDataFixed("viego_e", "restealth_time_ms", "Viego", "E", "RestealthTime", toMs);
mapDataFixed("viego_e", "ms_ap_ratio", "Viego", "E", "MSAPRatio");
mapFieldFixed("viego_e", "display_range", "Viego", "E", "castRangeDisplayOverride");
mapFieldFixed("viego_e", "missile_speed", "Viego", "E", "missileSpeed");
mapFieldFixed("viego_e", "spell_cast_time_ms", "Viego", "E", "spellCastTime", toMs, 0);
mapSkill("viego_r", "missing_health_percent_points", "Viego", "R", "MaxHealthDamage", 3);
mapDataFixed("viego_r", "total_ad_ratio", "Viego", "R", "ADRatio");
mapCoefficient("viego_r", "missing_health_bonus_ad_ratio", "Viego", "R", "TotalPercentHealth", 1);
mapDataFixed("viego_r", "slow_ratio", "Viego", "R", "SlowPercent");
mapDataFixed("viego_r", "slow_duration_ms", "Viego", "R", "SlowDuration", toMs);
mapDataFixed("viego_r", "crit_ratio", "Viego", "R", "CritMod");
mapFixed("viego_r", "percent_point_ratio", 0.01);
mapFixed("viego_r", "crit_base_multiplier", nestedNumber(calc("Viego", "R", "TotalDamage"), ["mMultiplier", "mSubparts", 0, "mNumber"], "佛耶戈R暴击基准"));
mapFixed("viego_r", "crit_subtract_one", nestedNumber(calc("Viego", "R", "TotalDamage"), ["mMultiplier", "mSubparts", 1, "mPart2", "mSubparts", 1, "mNumber"], "佛耶戈R暴击减一"));
mapRuntime("viego_r", "mstat8_actual");
mapRuntime("viego_r", "mstat9_actual");
mapFieldFixed("viego_r", "display_range", "Viego", "R", "castRangeDisplayOverride");

const parameterChecks = [];
const integerChecks = [];
let candidateParameterCount = 0;
for (const skillKey of candidate.order) {
  for (const parameter of candidate.skills[skillKey].write.parameters) {
    candidateParameterCount += 1;
    const expectedDefinition = expectedParameter.get(`${skillKey}/${parameter.parameterKey}`);
    let pass = Boolean(expectedDefinition) && parameter.valueMode === expectedDefinition?.mode;
    const detail = { skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, expectedMode: expectedDefinition?.mode || null };
    if (!expectedDefinition) detail.error = "没有独立源值映射";
    else if (expectedDefinition.mode === "FIXED") {
      detail.actual = parameter.fixedValue; detail.expected = expectedDefinition.value;
      pass = pass && parameter.levelValues === null && typeof parameter.fixedValue === "number" && Number.isFinite(parameter.fixedValue) && equal(parameter.fixedValue, expectedDefinition.value);
    } else if (expectedDefinition.mode === "SKILL_LEVEL") {
      detail.actual = parameter.levelValues; detail.expected = expectedDefinition.values;
      const actualKeys = Object.keys(parameter.levelValues || {}); const expectedKeys = Object.keys(expectedDefinition.values);
      pass = pass && parameter.fixedValue === null && JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) && expectedKeys.every(key => equal(parameter.levelValues[key], expectedDefinition.values[key]));
    } else if (expectedDefinition.mode === "RUNTIME_INPUT") pass = pass && parameter.fixedValue === null && parameter.levelValues === null;
    parameterChecks.push({ ...detail, pass });
    const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
    const finiteOk = parameter.valueMode === "RUNTIME_INPUT" ? parameter.fixedValue === null && parameter.levelValues === null : values.every(value => typeof value === "number" && Number.isFinite(value));
    const integerOk = parameter.valueType !== "INTEGER" || parameter.valueMode === "RUNTIME_INPUT" || values.every(value => Number.isInteger(value));
    const msOk = !parameter.parameterKey.endsWith("_ms") || parameter.valueMode === "RUNTIME_INPUT" || values.every(value => Number.isInteger(value) && value >= 0);
    integerChecks.push({ skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, finiteOk, integerOk, msOk, pass: finiteOk && integerOk && msOk });
  }
}
assert(candidateParameterCount === expectedParameter.size, `候选参数映射数量不符：${candidateParameterCount}/${expectedParameter.size}`);

const levelChecks = [];
const characterLevelChecks = [];
for (const skillKey of candidate.order) {
  const maxLevel = maxLevelOf(skillKey);
  assert(candidate.skills[skillKey].maxLevel === maxLevel, `候选最高等级漂移：${skillKey}`);
  for (const parameter of candidate.skills[skillKey].write.parameters) if (parameter.valueMode === "SKILL_LEVEL" || parameter.valueMode === "CHARACTER_LEVEL") {
    const expectedKeys = parameter.valueMode === "CHARACTER_LEVEL" ? Array.from({ length: 18 }, (_, index) => String(index + 1)) : Array.from({ length: maxLevel }, (_, index) => String(index + 1));
    const actualKeys = Object.keys(parameter.levelValues || {});
    const pass = JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);
    levelChecks.push({ skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, expectedKeys, actualKeys, pass });
    if (parameter.valueMode === "CHARACTER_LEVEL") characterLevelChecks.push({ skillKey, parameterKey: parameter.parameterKey, expectedKeys, actualKeys, pass });
  }
}

const structureIssues = [];
const attributeNodeChecks = [];
const effectAttributeChecks = [];
for (const skillKey of candidate.order) {
  const skillData = candidate.skills[skillKey];
  const localParameters = new Set(skillData.write.parameters.map(item => item.parameterKey));
  const publicParameters = new Set(reuseList.filter(item => item.skillKey === skillKey).map(item => item.parameterKey));
  for (const formulaData of skillData.write.formulas) {
    walk(formulaData.expression, node => {
      if (!["PARAMETER", "ATTRIBUTE", "OPERATION"].includes(node.nodeType)) structureIssues.push(`${skillKey}/${formulaData.formulaKey}:未知节点${node.nodeType}`);
      if (node.nodeType === "PARAMETER" && !localParameters.has(node.parameterKey) && !publicParameters.has(node.parameterKey)) structureIssues.push(`${skillKey}/${formulaData.formulaKey}:未声明参数${node.parameterKey}`);
      if (node.nodeType === "ATTRIBUTE") {
        const attributePath = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`;
        const keyExists = typeof node.attributeKey === "string" && frozenAttributeKeys.has(node.attributeKey);
        const pathAllowed = allowedAttributes.has(attributePath);
        attributeNodeChecks.push({ skillKey, formulaKey: formulaData.formulaKey, attributeOwner: node.attributeOwner, attributeKey: node.attributeKey, attributeValueKind: node.attributeValueKind, keyExistsInFrozenAttributes: keyExists, pathAllowed, pass: keyExists && pathAllowed });
        if (!keyExists || !pathAllowed) structureIssues.push(`${skillKey}/${formulaData.formulaKey}:未证属性${attributePath}`);
      }
      if (node.nodeType === "OPERATION" && (!Array.isArray(node.operands) || node.operands.length !== 2)) structureIssues.push(`${skillKey}/${formulaData.formulaKey}:操作数不是两个`);
      if (node.nodeType === "OPERATION" && !["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"].includes(node.operation)) structureIssues.push(`${skillKey}/${formulaData.formulaKey}:未知运算${node.operation}`);
    });
  }
  for (const effect of skillData.write.effects) {
    for (const ref of runtimeRefsOfEffect(effect)) if (!localParameters.has(ref) && !publicParameters.has(ref)) structureIssues.push(`${skillKey}/${effect.effectKey}:效果引用未声明参数${ref}`);
    for (const result of effect.results || []) {
      const detail = result.detail || {};
      const required = ["ATTRIBUTE_CHANGE", "RESOURCE_CHANGE"].includes(result.resultType) || Object.prototype.hasOwnProperty.call(detail, "attributeKey");
      if (required) {
        const keyExists = typeof detail.attributeKey === "string" && frozenAttributeKeys.has(detail.attributeKey);
        effectAttributeChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, resultType: result.resultType, attributeKey: detail.attributeKey ?? null, keyExistsInFrozenAttributes: keyExists, pass: keyExists });
        if (!keyExists) structureIssues.push(`${skillKey}/${effect.effectKey}/${result.resultKey}:detail.attributeKey未在冻结/attributes中`);
      }
    }
  }
}

const formulaResults = [];
const formulaMissingInputCases = [];
const referencedRuntimeInputs = new Set();
for (const skillKey of candidate.order) {
  for (const formulaData of candidate.skills[skillKey].write.formulas) {
    const refs = refsOf(formulaData.expression);
    for (const ref of refs) if (parameterOf(skillKey, ref)?.valueMode === "RUNTIME_INPUT") referencedRuntimeInputs.add(`${skillKey}/${ref}`);
    for (const index of [0, 1]) {
      const scenario = scenarioFor(skillKey, index);
      try {
        const actual = evaluate(formulaData.expression, parameterMap(skillKey, scenario.rank, scenario.characterLevel, scenario.inputs), attrsFor(scenario));
        const expectedValue = expected(skillKey, formulaData.formulaKey, scenario);
        formulaResults.push({ skillKey, formulaKey: formulaData.formulaKey, scene: index === 0 ? "基础场景" : "强化场景", rank: scenario.rank, characterLevel: scenario.characterLevel, inputs: { totalAD: scenario.totalAD, bonusAD: scenario.bonusAD, AP: scenario.AP, sourceMaxHP: scenario.sourceMaxHP, sourceMissingHP: scenario.sourceMissingHP, targetMaxHP: scenario.targetMaxHP, targetCurrentHP: scenario.targetCurrentHP, targetMissingHP: scenario.targetMissingHP, runtime: clone(scenario.inputs) }, actual: round(actual), expected: round(expectedValue), pass: equal(actual, expectedValue) });
      } catch (error) {
        formulaResults.push({ skillKey, formulaKey: formulaData.formulaKey, scene: index === 0 ? "基础场景" : "强化场景", pass: false, error: error.message });
      }
    }
    for (const ref of refs.filter(ref => parameterOf(skillKey, ref)?.valueMode === "RUNTIME_INPUT")) {
      const scenario = scenarioFor(skillKey, 0);
      const inputs = { ...scenario.inputs }; delete inputs[ref];
      let rejected = false; let error = null;
      try { evaluate(formulaData.expression, parameterMap(skillKey, scenario.rank, scenario.characterLevel, inputs), attrsFor(scenario)); } catch (caught) { rejected = true; error = caught.message; }
      formulaMissingInputCases.push({ skillKey, formulaKey: formulaData.formulaKey, missingParameterKey: ref, rejected, error });
    }
  }
}
const formulaPassCount = formulaResults.filter(item => item.pass).length;
const formulaFailCount = formulaResults.length - formulaPassCount;
const formulaDefinitionCount = candidate.order.reduce((sum, skillKey) => sum + candidate.skills[skillKey].write.formulas.length, 0);
const formulaAtLeastTwoScenes = candidate.order.every(skillKey => candidate.skills[skillKey].write.formulas.every(formulaData => formulaResults.filter(item => item.skillKey === skillKey && item.formulaKey === formulaData.formulaKey).length >= 2));

const sourceArrayIndexChecks = sourceArraySpecs.map(spec => {
  const parameter = parameterOf(spec.skillKey, spec.parameterKey);
  const expectedFirst = norm(spec.transform(dataAt(spec.heroId, spec.slot, spec.dataName, spec.start)));
  const expectedLast = norm(spec.transform(dataAt(spec.heroId, spec.slot, spec.dataName, spec.start + spec.count - 1)));
  const actualKeys = Object.keys(parameter?.levelValues || {});
  const expectedKeys = Array.from({ length: spec.count }, (_, index) => String(index + 1));
  return { skillKey: spec.skillKey, parameterKey: spec.parameterKey, source: `${spec.heroId}/${spec.slot}/${spec.dataName}`, sourceIndexStart: spec.start, sourceIndexEnd: spec.start + spec.count - 1, zeroIndexValue: dataRow(spec.heroId, spec.slot, spec.dataName)[0], actualKeys, expectedKeys, candidateLevel1: parameter?.levelValues?.["1"], candidateLast: parameter?.levelValues?.[String(spec.count)], expectedFirst, expectedLast, pass: Boolean(parameter) && JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) && equal(parameter.levelValues?.["1"], expectedFirst) && equal(parameter.levelValues?.[String(spec.count)], expectedLast) };
});
const sourceFixedIndexChecks = sourceFixedIndexSpecs.map(spec => {
  const sourceValue = spec.sourceKind === "DataValue" ? dataAt(spec.heroId, spec.slot, spec.name, spec.index) : fieldAt(spec.heroId, spec.slot, spec.name, spec.index);
  const parameter = parameterOf(spec.skillKey, spec.parameterKey);
  const expectedValue = norm(spec.transform(sourceValue));
  return { skillKey: spec.skillKey, parameterKey: spec.parameterKey, sourceKind: spec.sourceKind, source: `${spec.heroId}/${spec.slot}/${spec.name}`, sourceIndex: spec.index, sourceValue, candidateValue: parameter?.fixedValue, expectedValue, pass: Boolean(parameter) && typeof parameter.fixedValue === "number" && equal(parameter.fixedValue, expectedValue) };
});

const currentConsumerMap = [
  { skillKey: "ivern_q", heroId: "Ivern", slot: "Q", kind: "calculation", name: "TotalDamage", selected: "magic_damage", required: true },
  { skillKey: "ivern_q", heroId: "Ivern", slot: "Q", kind: "data", name: "RootDuration", selected: "root_duration_ms", required: true },
  { skillKey: "ivern_w", heroId: "Ivern", slot: "W", kind: "data", name: "BuffDuration", selected: "buff_duration_ms", required: true },
  { skillKey: "ivern_w", heroId: "Ivern", slot: "W", kind: "calculation", name: "TotalDamage", selected: "magic_damage", required: true },
  { skillKey: "ivern_w", heroId: "Ivern", slot: "W", kind: "data", name: "RevealDuration", selected: "reveal_duration_ms", required: true },
  { skillKey: "ivern_w", heroId: "Ivern", slot: "W", kind: "data", name: "MaxBrushDuration", selected: "max_brush_duration_ms", required: true },
  { skillKey: "ivern_w", heroId: "Ivern", slot: "W", kind: "field", name: "mAmmoRechargeTime", tokenNames: ["AmmoRechargeTime"], selected: "ammo_recharge_ms", required: true },
  { skillKey: "ivern_e", heroId: "Ivern", slot: "E", kind: "calculation", name: "TotalShield", selected: "shield", required: true },
  { skillKey: "ivern_e", heroId: "Ivern", slot: "E", kind: "data", name: "ShieldDuration", selected: "shield_duration_ms", required: true },
  { skillKey: "ivern_e", heroId: "Ivern", slot: "E", kind: "calculation", name: "TotalDamage", selected: "magic_damage", required: true },
  { skillKey: "ivern_e", heroId: "Ivern", slot: "E", kind: "data", name: "SlowDuration", selected: "slow_duration_ms", required: true },
  { skillKey: "ivern_e", heroId: "Ivern", slot: "E", kind: "data", name: "SlowAmount", tokenNames: ["SlowAmount*100"], selected: "slow_ratio", required: true },
  { skillKey: "yorick_q", heroId: "Yorick", slot: "Q", kind: "calculation", name: "BonusDamage", selected: "bonus_damage", required: true },
  { skillKey: "yorick_q", heroId: "Yorick", slot: "Q", kind: "calculation", name: "QHeal", selected: "q_heal_base_actual", required: true },
  { skillKey: "yorick_q", heroId: "Yorick", slot: "Q", kind: "data", name: "MissingHealthRatio", selected: "missing_health_percent_points", required: true },
  { skillKey: "yorick_e", heroId: "Yorick", slot: "E", kind: "calculation", name: "Calc_HealthDamage", selected: "max_health_magic_damage", required: true },
  { skillKey: "yorick_e", heroId: "Yorick", slot: "E", kind: "data", name: "SlowDuration", selected: "slow_duration_ms", required: true },
  { skillKey: "yorick_e", heroId: "Yorick", slot: "E", kind: "calculation", name: "Calc_Slow", selected: "slow_ratio", required: true },
  { skillKey: "yorick_e", heroId: "Yorick", slot: "E", kind: "data", name: "MarkDuration", selected: "mark_duration_ms", required: true },
  { skillKey: "yorick_e", heroId: "Yorick", slot: "E", kind: "data", name: "ArmorShred", tokenNames: ["ArmorShred*100"], selected: "armor_shred_ratio", required: true },
  { skillKey: "yorick_e", heroId: "Yorick", slot: "E", kind: "data", name: "HasteAmount", tokenNames: ["HasteAmount*100"], selected: "move_speed_ratio", required: true },
  { skillKey: "yorick_r", heroId: "Yorick", slot: "R", kind: "data", name: "RMarkDamagePercent", selected: "r_mark_damage_percent_points", required: true },
  { skillKey: "kayn_p", heroId: "Kayn", slot: "P", dynamic: true, kind: "data", name: "TransformationVariable", selected: null, required: false, reason: "变形竞争" },
  { skillKey: "kayn_q", heroId: "Kayn", slot: "Q", dynamic: true, kind: "calculation", name: "TotalDamage", selected: "single_physical_damage", required: true },
  { skillKey: "kayn_w", heroId: "Kayn", slot: "W", dynamic: true, kind: "calculation", name: "TotalDamage", selected: "physical_damage", required: true },
  { skillKey: "kayn_e", heroId: "Kayn", slot: "E", dynamic: true, kind: "calculation", name: "TotalHealing", selected: "self_healing", required: true },
  { skillKey: "kayn_e", heroId: "Kayn", slot: "E", dynamic: true, kind: "data", name: "MaxInCombatTime", tokenNames: ["Effect3Amount"], selected: "max_in_combat_ms", required: true },
  { skillKey: "kayn_r", heroId: "Kayn", slot: "R", dynamic: true, kind: "calculation", name: "Damage", selected: "physical_damage", required: true },
  { skillKey: "kayn_r", heroId: "Kayn", slot: "R", dynamic: true, kind: "data", name: "InfestDuration", selected: "max_infest_ms", required: true },
  { skillKey: "viego_q", heroId: "Viego", slot: "Q", kind: "calculation", name: "TotalDamage", selected: "active_physical_damage", required: true },
  { skillKey: "viego_q", heroId: "Viego", slot: "Q", kind: "calculation", name: "TotalPercentHealthOnHit", selected: "on_hit_current_health_damage", required: true },
  { skillKey: "viego_q", heroId: "Viego", slot: "Q", kind: "calculation", name: "SecondAttackDamage", selected: "second_attack_physical_damage", required: true },
  { skillKey: "viego_q", heroId: "Viego", slot: "Q", kind: "calculation", name: "HealthCritDamage", selected: "critical_on_hit_current_health_damage", required: true },
  { skillKey: "viego_q", heroId: "Viego", slot: "Q", kind: "data", name: "MinDamageOnHit", selected: "on_hit_min_damage", required: true },
  { skillKey: "viego_q", heroId: "Viego", slot: "Q", kind: "data", name: "HealModVsChamps", tokenNames: ["HealModVsChamps*100"], selected: "heal_mod_vs_champs", required: true },
  { skillKey: "viego_w", heroId: "Viego", slot: "W", kind: "calculation", name: "TotalDamage", selected: "magic_damage", required: true },
  { skillKey: "viego_w", heroId: "Viego", slot: "W", kind: "data", name: "SelfSlowPercent", tokenNames: ["SelfSlowPercent*100"], selected: "self_slow_ratio", required: true },
  { skillKey: "viego_w", heroId: "Viego", slot: "W", kind: "data", name: "StunDuration", tokenNames: ["Stunduration"], selected: "min_stun_duration_ms", required: true },
  { skillKey: "viego_w", heroId: "Viego", slot: "W", kind: "data", name: "MaxStunTT", selected: "max_stun_duration_ms", required: true },
  { skillKey: "viego_w", heroId: "Viego", slot: "W", kind: "data", name: "CDWheninterrupted", selected: "interrupted_cooldown_ms", required: true },
  { skillKey: "viego_e", heroId: "Viego", slot: "E", kind: "data", name: "MistDuration", selected: "mist_duration_ms", required: true },
  { skillKey: "viego_e", heroId: "Viego", slot: "E", kind: "calculation", name: "TotalMovespeed", tokenNames: ["TotalMoveSpeed"], selected: "total_move_speed", required: true },
  { skillKey: "viego_e", heroId: "Viego", slot: "E", kind: "data", name: "AttackSpeed", tokenNames: ["AttackSpeed*100"], selected: "attack_speed_ratio", required: true },
  { skillKey: "viego_e", heroId: "Viego", slot: "E", kind: "data", name: "RestealthTime", selected: "restealth_time_ms", required: true },
  { skillKey: "viego_r", heroId: "Viego", slot: "R", kind: "data", name: "SlowPercent", tokenNames: ["SlowPercent*100"], selected: "slow_ratio", required: true },
  { skillKey: "viego_r", heroId: "Viego", slot: "R", kind: "calculation", name: "TotalDamage", selected: "base_physical_damage", required: true },
  { skillKey: "viego_r", heroId: "Viego", slot: "R", kind: "calculation", name: "TotalPercentHealth", selected: "missing_health_physical_damage", required: true },
  { skillKey: "viego_r", heroId: "Viego", slot: "R", kind: "data", name: "CritMod", tokenNames: ["CritMod*100"], selected: "crit_ratio", required: true },
];
const textTokens = item => {
  const text = item.dynamic ? (dynamicByKey[dynamicKeyBySlot[item.slot]] || "") : Object.values(sourceSkills[item.heroId]?.[item.slot]?.currentTexts || {}).map(value => value?.text || "").join("\n");
  return [...text.matchAll(/@([^@]+)@/g)].map(match => match[1]);
};
const tokenMatches = (tokens, names) => {
  const lower = tokens.map(token => token.toLowerCase());
  return (names || [names]).some(name => {
    const wanted = String(name).toLowerCase();
    return lower.some(token => token === wanted || token.endsWith(`:${wanted}`));
  });
};
const sourceObjectExists = item => {
  if (item.kind === "data") return Boolean((spell(item.heroId, item.slot)?.DataValues || []).find(row => row.name === item.name));
  if (item.kind === "field") return spell(item.heroId, item.slot)?.[item.name] !== undefined && spell(item.heroId, item.slot)?.[item.name] !== null;
  return Boolean((spell(item.heroId, item.slot)?.mSpellCalculations || {})[item.name]);
};
const consumerChecks = currentConsumerMap.map(item => {
  const tokens = textTokens(item);
  const names = item.tokenNames || [item.name];
  const selected = item.selected === null ? false : Boolean(candidate.skills[item.skillKey].write.formulas.some(formulaData => formulaData.formulaKey === item.selected) || candidate.skills[item.skillKey].write.parameters.some(parameter => parameter.parameterKey === item.selected));
  const sourceExists = sourceObjectExists(item);
  const textContains = tokenMatches(tokens, names);
  return { ...item, sourceExists, textContains, selected, pass: item.required ? sourceExists && textContains && selected : !selected };
});

const effectChecks = [];
const ratioAttributeFlatAddChecks = [];
const effectRuntimeRefs = new Set();
for (const skillKey of candidate.order) {
  const scenario = scenarioFor(skillKey, 1);
  let params;
  try { params = parameterMap(skillKey, scenario.rank, scenario.characterLevel, scenario.inputs); } catch (error) { structureIssues.push(`${skillKey}:效果场景参数无法提供：${error.message}`); continue; }
  for (const effect of candidate.skills[skillKey].write.effects) {
    for (const ref of runtimeRefsOfEffect(effect)) {
      if (parameterOf(skillKey, ref)?.valueMode === "RUNTIME_INPUT") effectRuntimeRefs.add(`${skillKey}/${ref}`);
    }
    const duration = effect.lifecycle?.durationValue;
    let durationPass = true;
    if (duration?.kind === "PARAMETER") {
      try { durationPass = Number.isFinite(evaluate({ nodeType: "PARAMETER", parameterKey: duration.parameterKey }, params, attrsFor(scenario))); } catch { durationPass = false; }
    }
    for (const result of effect.results || []) {
      const valueRule = result.valueRule;
      const value = valueRule?.value;
      let finalValue = null; let valuePass = Boolean(valueRule && value && ["PARAMETER", "FORMULA"].includes(value.kind));
      try {
        if (valuePass && value.kind === "PARAMETER") finalValue = evaluate({ nodeType: "PARAMETER", parameterKey: value.parameterKey }, params, attrsFor(scenario));
        else if (valuePass && value.kind === "FORMULA") {
          const formulaData = candidate.skills[skillKey].write.formulas.find(item => item.formulaKey === value.formulaKey);
          if (!formulaData) valuePass = false;
          else finalValue = evaluate(formulaData.expression, params, attrsFor(scenario));
        }
      } catch { valuePass = false; }
      const multiplierPass = valueRule?.fixedMultiplier === 1;
      const finitePass = valuePass && typeof finalValue === "number" && Number.isFinite(finalValue);
      const detail = result.detail || {};
      const ratioPass = result.resultType !== "ATTRIBUTE_CHANGE" || detail.modifierZoneKey === "attribute_flat_add";
      const pass = finitePass && multiplierPass && ratioPass && durationPass;
      effectChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, resultType: result.resultType, valueKind: value?.kind || null, valueKey: value?.parameterKey || value?.formulaKey || null, finalValue: finitePass ? round(finalValue * (valueRule?.fixedMultiplier || 0)) : null, fixedMultiplier: valueRule?.fixedMultiplier ?? null, durationPass, valuePass, multiplierPass, ratioPass, pass });
      if (result.resultType === "ATTRIBUTE_CHANGE") ratioAttributeFlatAddChecks.push({ skillKey, effectKey: effect.effectKey, attributeKey: detail.attributeKey, modifierZoneKey: detail.modifierZoneKey, pass: ratioPass });
    }
  }
}
const effectMissingInputCases = [];
for (const key of effectRuntimeRefs) {
  const [skillKey, missingParameterKey] = key.split("/");
  const scenario = scenarioFor(skillKey, 0);
  const inputs = { ...scenario.inputs }; delete inputs[missingParameterKey];
  let rejected = false; let error = null;
  try { parameterMap(skillKey, scenario.rank, scenario.characterLevel, inputs); } catch (caught) { rejected = true; error = caught.message; }
  effectMissingInputCases.push({ skillKey, missingParameterKey, rejected, error });
}
const missingInputCases = [...formulaMissingInputCases, ...effectMissingInputCases];
const missingInputAllRejected = missingInputCases.length > 0 && missingInputCases.every(item => item.rejected);

const sourceTreeChecks = [
  { name: "IvernQ.TotalDamage.parts", pass: calcPart("Ivern", "Q", "TotalDamage", 0).mDataValue === "BaseDamage" && calcPart("Ivern", "Q", "TotalDamage", 1).mDataValue === "APRatio" },
  { name: "IvernW.TotalDamage.coefficient", actual: calcCoefficient("Ivern", "W", "TotalDamage"), expected: 0.2, pass: equal(calcCoefficient("Ivern", "W", "TotalDamage"), 0.2) },
  { name: "YorickQ.BonusDamage.totalAD", pass: calcPart("Yorick", "Q", "BonusDamage", 1).mDataValue === "BonusDamageAD" && calcPart("Yorick", "Q", "BonusDamage", 1).mStat === 2 && calcPart("Yorick", "Q", "BonusDamage", 1).mStatFormula === undefined },
  { name: "YorickE.CalcHealthDamage", actual: calcMultiplier("Yorick", "E", "Calc_HealthDamage"), expected: 0.01, pass: equal(calcMultiplier("Yorick", "E", "Calc_HealthDamage"), 0.01) && calcPart("Yorick", "E", "Calc_HealthDamage", 1).mDataValue === "HealthAPRatio" },
  { name: "KaynQ.TotalDamage.extraAD", pass: calcPart("Kayn", "Q", "TotalDamage", 1).mDataValue === "BonusADRatio" && calcPart("Kayn", "Q", "TotalDamage", 1).mStat === 2 && calcPart("Kayn", "Q", "TotalDamage", 1).mStatFormula === 2 },
  { name: "KaynW.TotalDamage.coefficient", actual: calcCoefficient("Kayn", "W", "TotalDamage"), expected: 1.1, pass: equal(calcCoefficient("Kayn", "W", "TotalDamage"), 1.1) && calcPart("Kayn", "W", "TotalDamage", 1).mStat === 2 },
  { name: "KaynR.Damage.coefficient", actual: calcCoefficient("Kayn", "R", "Damage"), expected: 1.5, pass: equal(calcCoefficient("Kayn", "R", "Damage"), 1.5) && calcPart("Kayn", "R", "Damage", 1).mStat === 2 },
  { name: "ViegoQ.TotalDamage.scope", pass: calc("Viego", "Q", "TotalDamage").mMultiplier?.mSubparts?.[1]?.mPart1?.mDataValue === "ActiveCritMod" && calc("Viego", "Q", "TotalDamage").mMultiplier?.mSubparts?.[1]?.mPart1?.mStat === 8 && calc("Viego", "Q", "TotalDamage").mMultiplier?.mSubparts?.[1]?.mPart2?.mSubparts?.[0]?.mStat === 9 },
  { name: "ViegoQ.HealthCritDamage.scope", pass: calc("Viego", "Q", "HealthCritDamage").mFormulaParts?.[1]?.mPart1?.mDataValue === "HealthCritMod" && calc("Viego", "Q", "HealthCritDamage").mFormulaParts?.[1]?.mPart1?.mStat === undefined && calc("Viego", "Q", "HealthCritDamage").mFormulaParts?.[1]?.mPart2?.mSubparts?.[0]?.mStat === 9 },
  { name: "ViegoR.TotalDamage.scope", pass: calc("Viego", "R", "TotalDamage").mMultiplier?.mSubparts?.[1]?.mPart1?.mDataValue === "CritMod" && calc("Viego", "R", "TotalDamage").mMultiplier?.mSubparts?.[1]?.mPart1?.mStat === 8 && calc("Viego", "R", "TotalDamage").mMultiplier?.mSubparts?.[1]?.mPart2?.mSubparts?.[0]?.mStat === 9 },
  { name: "ViegoR.TotalPercentHealth.extraAD", pass: calcPart("Viego", "R", "TotalPercentHealth", 1).mStat === 2 && calcPart("Viego", "R", "TotalPercentHealth", 1).mStatFormula === 2 && equal(calcCoefficient("Viego", "R", "TotalPercentHealth", 1), 0.05) },
];

const findFormula = (skillKey, formulaKey) => candidate.skills[skillKey].write.formulas.find(item => item.formulaKey === formulaKey);
const refsWithAttributes = (skillKey, formulaKey) => {
  const result = { parameters: refsOf(findFormula(skillKey, formulaKey)?.expression), attributes: [] };
  walk(findFormula(skillKey, formulaKey)?.expression, node => { if (node.nodeType === "ATTRIBUTE") result.attributes.push(`${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`); });
  return result;
};
const viegoQActiveRefs = refsWithAttributes("viego_q", "active_physical_damage");
const viegoQCritRefs = refsWithAttributes("viego_q", "critical_on_hit_current_health_damage");
const viegoQOnHitRefs = refsWithAttributes("viego_q", "on_hit_current_health_damage");
const viegoRBaseRefs = refsWithAttributes("viego_r", "base_physical_damage");
const viegoRMissingRefs = refsWithAttributes("viego_r", "missing_health_physical_damage");
const viegoRFullRefs = refsWithAttributes("viego_r", "physical_damage");
const hpScopeChecks = [
  { name: "ViegoQ主动含mStat8/mStat9", pass: viegoQActiveRefs.parameters.includes("active_mstat8") && viegoQActiveRefs.parameters.includes("active_mstat9") },
  { name: "ViegoQ暴击只含mStat9且独立第二当前生命", pass: viegoQCritRefs.parameters.includes("on_hit_crit_mstat9") && viegoQCritRefs.parameters.includes("second_attack_current_hp") && !viegoQCritRefs.parameters.includes("active_mstat8") && !viegoQCritRefs.parameters.includes("active_mstat9") },
  { name: "ViegoQ第一次攻击读取当前生命", pass: viegoQOnHitRefs.attributes.includes("TARGET/hp/CURRENT") },
  { name: "ViegoR基础段含mStat8/mStat9", pass: viegoRBaseRefs.parameters.includes("mstat8_actual") && viegoRBaseRefs.parameters.includes("mstat9_actual") },
  { name: "ViegoR已损生命段不含暴击输入", pass: viegoRMissingRefs.attributes.includes("TARGET/hp/MISSING") && !viegoRMissingRefs.parameters.includes("mstat8_actual") && !viegoRMissingRefs.parameters.includes("mstat9_actual") },
  { name: "ViegoR完整树同时保留两段", pass: viegoRFullRefs.attributes.includes("TARGET/hp/MISSING") && viegoRFullRefs.parameters.includes("mstat8_actual") },
  { name: "场景三种生命值均不同", pass: scenarioFor("viego_q", 1).targetMaxHP !== scenarioFor("viego_q", 1).targetCurrentHP && scenarioFor("viego_q", 1).targetCurrentHP !== scenarioFor("viego_q", 1).targetMissingHP && scenarioFor("viego_q", 1).totalAD !== scenarioFor("viego_q", 1).bonusAD },
];
const dynamicKeyChecks = Object.entries(dynamicKeyBySlot).map(([slot, key]) => ({ slot, key, exists: typeof dynamicByKey[key] === "string" && dynamicByKey[key].length > 0, selected: candidate.meta.dynamicTextSource?.selectedKeys?.[slot] === key, pass: typeof dynamicByKey[key] === "string" && dynamicByKey[key].length > 0 && candidate.meta.dynamicTextSource?.selectedKeys?.[slot] === key }));
const qualificationChecks = [
  { name: "艾翁E资格补证仅支持窄范围自身", pass: /自身/.test(qualificationText) && candidate.skills.ivern_e.write.effects.filter(effect => effect.results?.some(result => result.target === "SOURCE")).length === 2 && candidate.skills.ivern_e.write.effects.every(effect => (effect.results || []).every(result => result.target === "SOURCE" || result.target === "TARGET")) },
  { name: "约里克W独立生命墙排除", pass: candidate.skills.yorick_w.write.parameters.length === 0 && candidate.skills.yorick_w.write.formulas.length === 0 && candidate.skills.yorick_w.write.effects.length === 0 },
  { name: "约里克Q断点保持运行输入", pass: parameterOf("yorick_q", "q_heal_base_actual")?.valueMode === "RUNTIME_INPUT" && parameterOf("yorick_q", "q_heal_base_actual")?.fixedValue === null && parameterOf("yorick_q", "q_heal_base_actual")?.levelValues === null && !candidate.skills.yorick_q.write.parameters.some(parameter => parameter.parameterKey === "q_heal_base_actual" && parameter.valueMode !== "RUNTIME_INPUT") },
];
const runtimeNoDefaultChecks = candidate.order.flatMap(skillKey => candidate.skills[skillKey].write.parameters.filter(parameter => parameter.valueMode === "RUNTIME_INPUT").map(parameter => ({ skillKey, parameterKey: parameter.parameterKey, fixedValue: parameter.fixedValue, levelValues: parameter.levelValues, pass: parameter.fixedValue === null && parameter.levelValues === null })));

const integerParameterChecks = integerChecks.filter(item => candidate.skills[item.skillKey].write.parameters.find(parameter => parameter.parameterKey === item.parameterKey)?.valueType === "INTEGER");
const integerParameterCount = integerParameterChecks.length;
const integerParameterPassCount = integerParameterChecks.filter(item => item.pass).length;
const integerValueCount = integerParameterChecks.reduce((sum, item) => {
  const parameter = parameterOf(item.skillKey, item.parameterKey);
  return sum + (parameter?.valueMode === "FIXED" ? 1 : parameter?.valueMode === "SKILL_LEVEL" || parameter?.valueMode === "CHARACTER_LEVEL" ? Object.keys(parameter.levelValues || {}).length : 0);
}, 0);
const integerValuePassCount = integerParameterChecks.reduce((sum, item) => {
  const parameter = parameterOf(item.skillKey, item.parameterKey);
  const values = parameter?.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter?.levelValues || {});
  return sum + values.filter(value => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)).length;
}, 0);
const ratioAttributeFlatAddAllPass = ratioAttributeFlatAddChecks.every(item => item.pass);
const effectFinalMultiplierAllPass = effectChecks.length === candidate.counts.newEffects && effectChecks.every(item => item.pass && item.multiplierPass);
const publicReuseAllProtected = reuseList.length === 21 && reuseList.every(item => publicData.has(`${item.skillKey}/${item.parameterKey}`));
const maxLevelChecks = candidate.order.map(skillKey => ({ skillKey, candidateMaxLevel: candidate.skills[skillKey].maxLevel, protectedMaxLevel: maxLevelOf(skillKey), pass: candidate.skills[skillKey].maxLevel === maxLevelOf(skillKey) }));
const noUnitExclusionParameters = candidate.order.flatMap(skillKey => candidate.skills[skillKey].write.parameters.map(parameter => ({ skillKey, parameterKey: parameter.parameterKey, pass: !/(monster|minion|clone|trap|plant|seed|vision)/i.test(parameter.parameterKey) })));
const missingInputAllRuntimeRejected = missingInputAllRejected && missingInputCases.length > 0;
const allFormulaPass = formulaFailCount === 0 && formulaAtLeastTwoScenes;
const allChecksPass = allFormulaPass && missingInputAllRuntimeRejected && parameterChecks.every(item => item.pass) && integerChecks.every(item => item.pass) && levelChecks.every(item => item.pass) && sourceArrayIndexChecks.every(item => item.pass) && sourceFixedIndexChecks.every(item => item.pass) && attributeNodeChecks.length > 0 && attributeNodeChecks.every(item => item.pass) && effectAttributeChecks.length > 0 && effectAttributeChecks.every(item => item.pass) && structureIssues.length === 0 && consumerChecks.filter(item => item.required).every(item => item.pass) && effectFinalMultiplierAllPass && ratioAttributeFlatAddAllPass && sourceTreeChecks.every(item => item.pass) && hpScopeChecks.every(item => item.pass) && dynamicKeyChecks.every(item => item.pass) && qualificationChecks.every(item => item.pass) && runtimeNoDefaultChecks.every(item => item.pass) && noUnitExclusionParameters.every(item => item.pass) && publicReuseAllProtected && maxLevelChecks.every(item => item.pass) && candidate.order.every(skillKey => candidate.skills[skillKey].protectedExisting?.subject === true);

const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  batch: candidate.meta.batch,
  revision: candidate.meta.revision,
  status: "独立源值数学核算已执行；未调用业务接口、浏览器或Git",
  sourceBasis: {
    clientVersion: binding.clientVersion,
    officialVersion: binding.officialVersion,
    build: candidate.meta.sourceVersion?.build,
    sourceIndexSha256: inputVersion.sourceIndexSha256,
    candidateSha256: shaFile(CANDIDATE_FILE),
    sourceBindingSha256: shaFile(bindingFile),
    sourceRangeSha256: shaFile(rangeFile),
    sourceAuditSha256: shaFile(sourceNoteFile),
    dynamicTextSha256: shaFile(dynamicFile),
    cursorReviewSha256: shaFile(cursorConclusionFile),
    protectionSnapshotSha256: shaFile(protectionFile),
    publicReuseSha256: shaFile(reuseFile),
    frozenAttributesRoute: "/attributes",
    frozenAttributeSnapshotCount: frozenAttributeItems.length,
    expectedSide: "直接读取冻结输入原始DataValues、计算树、字段和动态正文按源值重算，不从候选参数倒推期望值。",
    actualSide: "读取候选表达式，以显式技能等级、角色等级、属性和具名无默认运行输入求值。",
  },
  formulaResults,
  formulaCount: formulaResults.length,
  formulaDefinitionCount,
  formulaScenarioCount: formulaResults.length,
  formulaPassCount,
  formulaScenarioPassCount: formulaPassCount,
  formulaFailCount,
  formulaAtLeastTwoScenes,
  missingInputCases,
  missingInputCaseCount: missingInputCases.length,
  formulaMissingInputCaseCount: formulaMissingInputCases.length,
  effectMissingInputCaseCount: effectMissingInputCases.length,
  missingInputAllRejected,
  referencedRuntimeInputs: Array.from(referencedRuntimeInputs),
  referencedEffectRuntimeInputs: Array.from(effectRuntimeRefs),
  parameterChecks,
  parameterCheckCount: parameterChecks.length,
  parameterCheckPassCount: parameterChecks.filter(item => item.pass).length,
  parameterCheckFailCount: parameterChecks.filter(item => !item.pass).length,
  levelChecks,
  levelCheckAllPass: levelChecks.every(item => item.pass),
  characterLevelChecks,
  characterLevelCount: characterLevelChecks.length,
  characterLevelAllPass: characterLevelChecks.every(item => item.pass),
  sourceArrayIndexChecks,
  sourceArrayIndexAllPass: sourceArrayIndexChecks.every(item => item.pass),
  sourceFixedIndexChecks,
  sourceFixedIndexAllPass: sourceFixedIndexChecks.every(item => item.pass),
  frozenAttributeKeyCount: frozenAttributeKeys.size,
  attributeNodeChecks,
  attributeNodeCheckCount: attributeNodeChecks.length,
  attributeNodeAllPass: attributeNodeChecks.length > 0 && attributeNodeChecks.every(item => item.pass),
  effectAttributeChecks,
  effectAttributeCheckCount: effectAttributeChecks.length,
  effectAttributeAllPass: effectAttributeChecks.length > 0 && effectAttributeChecks.every(item => item.pass),
  integerChecks,
  integerParameterCount,
  integerParameterPassCount,
  integerValueCount,
  integerValuePassCount,
  integerAndModeAllPass: integerChecks.every(item => item.pass),
  structureIssues,
  allFormulaOperationsBinary: structureIssues.length === 0,
  sourceTreeChecks,
  sourceTreeAllPass: sourceTreeChecks.every(item => item.pass),
  consumerChecks,
  currentConsumerAllPass: consumerChecks.filter(item => item.required).every(item => item.pass),
  excludedConsumerChecks: consumerChecks.filter(item => !item.required),
  effectChecks,
  effectCount: effectChecks.length,
  effectFinalMultiplierCheckCount: effectChecks.length,
  effectFinalMultiplierAllPass,
  ratioAttributeFlatAddChecks,
  ratioAttributeFlatAddAllPass,
  hpScopeChecks,
  hpScopeAllPass: hpScopeChecks.every(item => item.pass),
  dynamicKeyChecks,
  dynamicKeysAllPass: dynamicKeyChecks.every(item => item.pass),
  qualificationChecks,
  qualificationAllPass: qualificationChecks.every(item => item.pass),
  runtimeNoDefaultChecks,
  runtimeNoDefaultAllPass: runtimeNoDefaultChecks.every(item => item.pass),
  selectedBannedParameterChecks: noUnitExclusionParameters,
  noUnitExclusionParameters: noUnitExclusionParameters.every(item => item.pass),
  publicReuseCount: reuseList.length,
  publicReuseExpected: 21,
  publicReuseAllProtected,
  protectedSubjectsAllPresent: candidate.order.every(skillKey => candidate.skills[skillKey].protectedExisting?.subject === true),
  maxLevelChecks,
  maxLevelAllPass: maxLevelChecks.every(item => item.pass),
  inputProtection: { GETs: inputVersion.GETs, expectedGETs: 193, apiWrites: inputVersion.apiWrites, expectedApiWrites: 0, cursorInputsChecked: cursorAudit.inputsChecked },
  noApiCalls: true,
  noBrowserCalls: true,
  noGitWrites: true,
  apiWrites: 0,
  businessWrites: 0,
  statusPass: allChecksPass,
  scenarios: {
    基础场景: "技能等级1（单级槽为1；R为1级）、角色等级1；总攻击力220、额外攻击力100、法强130；来源最大生命2600、当前1700、已损900；目标最大生命1400、当前700、已损700。",
    强化场景: "取各技能保护快照最高等级、角色等级18；总攻击力420、额外攻击力240、法强480；来源最大生命3800、当前2400、已损1400；目标最大生命2600、当前1500、已损1100。",
    missingInput: "逐公式和效果生命周期移除所引用的RUNTIME_INPUT，必须拒绝计算；候选没有默认值。",
    unknowns: "约里克Q QHeal断点当级仍未知；佛耶戈mStat8/mStat9和实际伤害/治疗资格由运行层输入；不编造默认或18级曲线。",
  },
};

const reportBytes = jsonBytes(report);
const reportSha256 = sha256(reportBytes);
const experienceText = [
  "# 第四十八批体验补充报告",
  "",
  "本报告对应固定客户端16.17、官方16.17.1的艾翁、约里克、凯隐、佛耶戈20个当前根技能槽。候选保留当前根本体伤害、控制、同一敌人重复命中、自身属性和基础资源；完整变形、替换套装、召唤物、灵墙、陷阱、兵野分支和额外敌人分配留在范围外。",
  "",
  "艾翁Q保留本人冲向同一被禁锢敌人的1500速度、250毫秒mCastTime和spellCastTime、1150实际距离/1125显示距离/1300弹速分开记录；艾翁W把本体20至50+0.2法强附伤的3秒窗口与45秒草丛寿命、8秒显形、3充能、20秒充能和0.5秒间隔分开。艾翁E只记录自身护盾、爆裂伤害、减速和原盾仍存且未命中敌方英雄时的二次护盾条件；自身资格只来自输入包外部检索摘要，官方正文未直接写自己。",
  "",
  "约里克Q额外物理段不含基础普攻，治疗使用具名无默认QHeal实际输入和自身已损生命；源树的10/2/7级后3/13级后5断点保留在源值摘要，未生成18级曲线。约里克E严格使用0.01×(HealthDamage+0.03法强)×目标最大生命；约里克R保留本人攻击室女标记目标的2/2.5/3%最大生命魔伤，不创建室女或雾行者。约里克W独立生命墙完全排除。",
  "",
  "凯隐P动态0只作为两种变形专用被动排除证据；Q/W/E按未变形动态0保留，Q的tooltipOnly TotalDamage和冲刺/旋转双段等额，R严格使用spell_kayn_r_main_0，标记3.15秒、侵入0.5至2.5秒、破体150/250/350+1.5额外攻击力均保留。E的7至9秒数组、地形外1.5秒、英雄战斗最长1.5秒和首次入地形90至130+0.45额外攻击力治疗分开记录。",
  "",
  "佛耶戈Q主动段按(基础+0.7总攻击力)乘[1+0.6×mStat8×(mStat9−1)]，第一次攻击读取目标当前生命，暴击攻击特效只读mStat9并使用第二次独立当前生命输入；第二次打击为0.2总攻击力+0.15法强，治疗使用1.5倍合资格实际伤害。佛耶戈R基础攻击力段含暴击修正，已损生命段读取目标MISSING HP且不乘暴击修正；两个段均保留在完整树。",
  "",
  `独立数学核算结果：${report.statusPass ? "通过" : "存在失败项"}；${report.formulaDefinitionCount}个公式各跑两个场景（${report.formulaScenarioCount}条场景记录），${report.missingInputCaseCount}个公式/效果缺输入案例全部拒绝；新参数${candidate.counts.newParameters}、新公式${candidate.counts.newFormulas}、新效果${candidate.counts.newEffects}，整数参数${report.integerParameterCount}个、整数值${report.integerValueCount}个分开统计；源数组索引、有限数值、完整等级、二元运算、效果最终倍率、${report.attributeNodeCheckCount}个ATTRIBUTE节点、${report.effectAttributeCheckCount}个效果detail.attributeKey和比例属性attribute_flat_add均纳入检查。`,
  "",
  "尚待运行层补证：艾翁E自身目标的直接官方证明、艾翁W草丛和附伤事件、约里克Q断点当级和治疗实际输入、约里克R标记资格、凯隐同一敌人的命中/标记/侵入时序、佛耶戈mStat8/mStat9枚举、Q最低伤害取大和实际伤害/治疗资格。未知实际输入均不设默认。",
  "",
  "Cursor实际只读复核为READY，审计4485事件、74个工具、26个冻结输入，业务写入和Git变化均为零。本报告和候选只表示静态来源与数学证据，不表示真实数据库、运行时、页面或战斗已完成。",
  "",
].join("\n");
const experienceBytes = Buffer.from(experienceText, "utf8");
const scriptBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const scriptSha256 = sha256(scriptBytes);
for (const directory of [ROOT, DURABLE]) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "独立数学报告.json"), reportBytes);
  fs.writeFileSync(path.join(directory, "独立数学核算.mjs"), scriptBytes);
  fs.writeFileSync(path.join(directory, "体验报告.md"), experienceBytes);
}
const updateVersion = directory => {
  const file = path.join(directory, "候选版本.json");
  const version = readJson(file);
  version.status = report.statusPass ? "候选冻结，独立数学核算已通过；未调用业务接口" : "候选冻结，独立数学核算存在失败；未调用业务接口";
  version.sourceMathStatus = report.statusPass ? "独立数学核算已通过" : "独立数学核算存在失败";
  version.mathReportSha256 = reportSha256;
  version.mathScriptSha256 = scriptSha256;
  version.experienceReportSha256 = sha256(experienceBytes);
  version.mathFormulaCount = report.formulaCount;
  version.mathFormulaDefinitionCount = report.formulaDefinitionCount;
  version.mathFormulaScenarioCount = report.formulaScenarioCount;
  version.mathFormulaPassCount = report.formulaPassCount;
  version.mathFormulaFailCount = report.formulaFailCount;
  version.mathMissingInputCaseCount = report.missingInputCaseCount;
  version.mathMissingInputAllRejected = report.missingInputAllRejected;
  version.integerParameterCount = report.integerParameterCount;
  version.integerParameterPassCount = report.integerParameterPassCount;
  version.integerValueCount = report.integerValueCount;
  version.integerValuePassCount = report.integerValuePassCount;
  version.apiCalls = 0; version.apiWrites = 0; version.businessWrites = 0; version.noBusinessWrites = true;
  fs.writeFileSync(file, jsonBytes(version));
  return fs.readFileSync(file);
};
for (const directory of [ROOT, DURABLE]) updateVersion(directory);
const updateFreezeNotice = directory => {
  const file = path.join(directory, "来源冻结通知.json");
  const notice = readJson(file);
  notice.status = report.statusPass ? "候选冻结，独立数学核算已通过；未调用业务接口" : "候选冻结，独立数学核算存在失败；未调用业务接口";
  notice.mathReportSha256 = reportSha256;
  notice.mathScriptSha256 = scriptSha256;
  notice.experienceReportSha256 = sha256(experienceBytes);
  notice.mathFormulaDefinitionCount = report.formulaDefinitionCount;
  notice.mathFormulaScenarioCount = report.formulaScenarioCount;
  notice.mathFormulaPassCount = report.formulaPassCount;
  notice.mathFormulaFailCount = report.formulaFailCount;
  notice.mathMissingInputCaseCount = report.missingInputCaseCount;
  notice.mathMissingInputAllRejected = report.missingInputAllRejected;
  notice.attributeNodeCheckCount = report.attributeNodeCheckCount;
  notice.attributeNodeAllPass = report.attributeNodeAllPass;
  notice.effectAttributeCheckCount = report.effectAttributeCheckCount;
  notice.effectAttributeAllPass = report.effectAttributeAllPass;
  notice.apiCalls = 0; notice.apiWrites = 0; notice.businessWrites = 0;
  fs.writeFileSync(file, jsonBytes(notice));
};
for (const directory of [ROOT, DURABLE]) updateFreezeNotice(directory);
const updateSummary = directory => {
  const file = path.join(directory, "来源哈希汇总.json");
  const summary = readJson(file);
  const record = name => { const bytes = fs.readFileSync(path.join(directory, name)); summary.outputFiles[name] = { sha256: sha256(bytes), byteSize: bytes.length }; };
  for (const name of ["候选版本.json", "来源冻结通知.json", "独立数学报告.json", "独立数学核算.mjs", "体验报告.md"]) record(name);
  const mathBytes = fs.readFileSync(path.join(directory, "独立数学报告.json"));
  summary.mathReport = { file: "独立数学报告.json", sha256: sha256(mathBytes), byteSize: mathBytes.length, formulaCount: report.formulaCount, formulaDefinitionCount: report.formulaDefinitionCount, formulaScenarioCount: report.formulaScenarioCount, formulaPassCount: report.formulaPassCount, formulaScenarioPassCount: report.formulaScenarioPassCount, formulaFailCount: report.formulaFailCount, missingInputCaseCount: report.missingInputCaseCount, formulaMissingInputCaseCount: report.formulaMissingInputCaseCount, effectMissingInputCaseCount: report.effectMissingInputCaseCount, attributeNodeCheckCount: report.attributeNodeCheckCount, effectAttributeCheckCount: report.effectAttributeCheckCount, attributeNodeAllPass: report.attributeNodeAllPass, effectAttributeAllPass: report.effectAttributeAllPass, statusPass: report.statusPass };
  summary.noApiCalls = true; summary.apiWrites = 0;
  fs.writeFileSync(file, jsonBytes(summary));
};
for (const directory of [ROOT, DURABLE]) updateSummary(directory);
const updateManifest = directory => {
  const file = path.join(directory, "文件散列.json");
  const manifest = readJson(file);
  for (const name of ["候选版本.json", "来源冻结通知.json", "独立数学报告.json", "独立数学核算.mjs", "体验报告.md", "来源哈希汇总.json"]) {
    const bytes = fs.readFileSync(path.join(directory, name)); manifest.files[name] = { sha256: sha256(bytes), byteSize: bytes.length };
  }
  manifest.mathReport = { file: "独立数学报告.json", sha256: reportSha256, byteSize: reportBytes.length, formulaCount: report.formulaCount, formulaDefinitionCount: report.formulaDefinitionCount, formulaScenarioCount: report.formulaScenarioCount, formulaPassCount: report.formulaPassCount, formulaScenarioPassCount: report.formulaScenarioPassCount, formulaFailCount: report.formulaFailCount, missingInputCaseCount: report.missingInputCaseCount, attributeNodeCheckCount: report.attributeNodeCheckCount, effectAttributeCheckCount: report.effectAttributeCheckCount, attributeNodeAllPass: report.attributeNodeAllPass, effectAttributeAllPass: report.effectAttributeAllPass, statusPass: report.statusPass };
  manifest.experienceReport = { file: "体验报告.md", sha256: sha256(experienceBytes), byteSize: experienceBytes.length };
  manifest.noApiCalls = true; manifest.apiWrites = 0;
  fs.writeFileSync(file, jsonBytes(manifest));
};
for (const directory of [ROOT, DURABLE]) updateManifest(directory);
console.log(JSON.stringify({ statusPass: report.statusPass, candidateSha256: shaFile(CANDIDATE_FILE), reportSha256, scriptSha256, experienceSha256: sha256(experienceBytes), counts: candidate.counts, formula: { definitions: report.formulaDefinitionCount, scenarios: report.formulaScenarioCount, pass: report.formulaPassCount, fail: report.formulaFailCount }, missingInput: { total: report.missingInputCaseCount, formula: report.formulaMissingInputCaseCount, effect: report.effectMissingInputCaseCount, allRejected: report.missingInputAllRejected }, integer: { parameters: report.integerParameterCount, parameterPass: report.integerParameterPassCount, values: report.integerValueCount, valuePass: report.integerValuePassCount }, cursor: { verdict: "READY", events: 4485, uniqueTools: 74, inputsChecked: 26 }, apiCalls: 0, browserCalls: 0, apiWrites: 0, gitWrites: 0 }, null, 2));
