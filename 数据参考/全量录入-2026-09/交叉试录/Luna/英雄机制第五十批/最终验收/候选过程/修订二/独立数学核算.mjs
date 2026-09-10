import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(ROOT, "..", "..", "hero50-root-entry-20260910");
const DURABLE = path.resolve(ROOT, "..", "..", "..", "..", "数据参考", "全量录入-2026-09", "交叉试录", "Luna", "英雄机制第五十批", "修订二");
const REVIEW = path.resolve(ROOT, "..", "..", "hero50-cursor-review-run-20260910");
const CANDIDATE_FILE = path.join(ROOT, "完整候选.json");
const PLAN_FILE = path.join(ROOT, "请求计划.json");
const SCOPE_FILE = path.join(ROOT, "来源与范围.json");
const SOURCE_VALUES_FILE = path.join(ROOT, "来源值摘要.json");
const VERSION_FILE = path.join(ROOT, "候选版本.json");
const FREEZE_FILE = path.join(ROOT, "来源冻结通知.json");
const HASHES_FILE = path.join(ROOT, "来源哈希汇总.json");
const MANIFEST_FILE = path.join(ROOT, "文件散列.json");
const MATH_FILE = path.join(ROOT, "独立数学核算.mjs");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const writeBytes = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const writeJson = (file, value) => writeBytes(file, jsonBytes(value));
const clone = value => JSON.parse(JSON.stringify(value));
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
const toMsSigned = seconds => {
  const raw = Number(seconds);
  const milliseconds = raw * 1000;
  const rounded = Math.round(milliseconds);
  assert(Number.isFinite(raw) && Math.abs(milliseconds - rounded) <= 1e-3, `时间不是可精确换算的整数毫秒：${seconds}`);
  return rounded;
};

const candidate = readJson(CANDIDATE_FILE);
const plan = readJson(PLAN_FILE);
const scope = readJson(SCOPE_FILE);
const sourceValues = readJson(SOURCE_VALUES_FILE);
const withheld = readJson(path.join(ROOT, "待补护盾证据.json"));
const revisionDiff = readJson(path.join(ROOT, "修订差异.json"));
const baseCandidateForRevision = readJson(path.resolve(ROOT, "..", "修订一", "完整候选.json"));
const inputVersion = readJson(path.join(INPUT, "输入版本.json"));
const binding = readJson(path.join(INPUT, "来源绑定与当前文本.json"));
const protection = readJson(path.join(INPUT, "参考资料", "当前20槽保护快照.json"));
const reuseList = readJson(path.join(INPUT, "参考资料", "公共参数复用清单.json"));
const cursorAudit = readJson(path.join(REVIEW, "主负责人执行审计.json"));
const cursorSummary = readJson(path.join(REVIEW, "summary.json"));
const cursorConclusion = fs.readFileSync(path.join(REVIEW, "Cursor来源复核结论.md"), "utf8");
const protectedByRoute = new Map((protection.requests || []).map(item => [item.route, item]));
const heroes = Object.fromEntries((binding.heroes || []).map(hero => [hero.id, hero]));
const sourceSkills = Object.fromEntries((binding.heroes || []).map(hero => [hero.id, Object.fromEntries((hero.skills || []).map(skill => [skill.slot, skill]))]));
const skillKeyOf = (heroId, slot) => `${heroes[heroId]?.key === "ez" ? "ez" : heroId.toLowerCase()}_${slot.toLowerCase()}`;
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
const coefficient = (heroId, slot, name, index = 1) => {
  const value = calcPart(heroId, slot, name, index).mCoefficient;
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树系数：${heroId}/${slot}/${name}/${index}`);
  return value;
};
const numberPart = (heroId, slot, name, index = 0) => {
  const value = calcPart(heroId, slot, name, index).mNumber;
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树固定数字：${heroId}/${slot}/${name}/${index}`);
  return value;
};
const endpoint = (heroId, slot, name, index = 0) => {
  const part = calcPart(heroId, slot, name, index);
  assert(typeof part.mStartValue === "number" && Number.isFinite(part.mStartValue), `缺少源树起点：${heroId}/${slot}/${name}`);
  assert(typeof part.mEndValue === "number" && Number.isFinite(part.mEndValue), `缺少源树终点：${heroId}/${slot}/${name}`);
  return { start: part.mStartValue, end: part.mEndValue };
};
const nested = (object, keys, label) => {
  let value = object;
  for (const key of keys) value = value?.[key];
  assert(typeof value === "number" && Number.isFinite(value), `缺少源树数值：${label}`);
  return value;
};
const protectedSkill = skillKey => {
  const hit = protectedByRoute.get(`/skills/${skillKey}`);
  assert(hit?.status === 200 && Number.isInteger(hit.data?.maxLevel), `缺少技能主体保护：${skillKey}`);
  return hit.data;
};
const parameterOf = (skillKey, parameterKey) => candidate.skills[skillKey]?.write.parameters.find(item => item.parameterKey === parameterKey);
const publicParametersFor = skillKey => reuseList.filter(item => item.skillKey === skillKey);
const publicData = new Map();
for (const item of reuseList) {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const hit = protectedByRoute.get(route);
  assert(hit?.status === 200 && hit.data, `公共参数保护缺失：${route}`);
  publicData.set(`${item.skillKey}/${item.parameterKey}`, clone(hit.data));
}

assert(candidate.order?.length === 20 && new Set(candidate.order).size === 20 && candidate.order.every(key => candidate.skills?.[key]), "候选不是完整20槽");
assert(candidate.meta?.sourceVersion?.clientVersion === "16.17" && candidate.meta?.sourceVersion?.officialVersion === "16.17.1", "候选来源版本不符");
assert(inputVersion.GETs === 292 && inputVersion.reusedParameters === 26 && inputVersion.apiWrites === 0, "冻结输入计数或写入状态不符");
assert(protection.GETs === 292 && protection.apiWrites === 0 && protection.requests.length === 292, "保护快照计数不符");
assert(reuseList.length === 26 && candidate.reusedPublicParameters.length === 26, "公共参数复用数量不符");
assert(candidate.apiWrites === 0 && candidate.meta.apiWrites === 0 && candidate.meta.apiCalls === 0, "候选写入状态不符");
assert(cursorAudit.readonlyAuditPassed === true && cursorAudit.resultStatus === "finished" && cursorAudit.events === 3550 && cursorAudit.uniqueTools === 63 && cursorAudit.inputsChecked === 27 && cursorAudit.apiWrites === 0, "Cursor只读审计不符");
assert((Array.isArray(cursorAudit.gitDelta) ? cursorAudit.gitDelta.length : Number(cursorAudit.gitDelta || 0)) === 0, "Cursor审计存在Git变化");
assert(cursorAudit.reviewedPlanRev === "hero50-source-v1" && cursorSummary.resultStatus === "finished" && /READY/.test(cursorConclusion), "Cursor来源评审没有READY");
assert(plan.noApiCalls === true && plan.apiWrites === 0 && plan.businessWrites === 0, "写前计划状态不符");
assert(candidate.revision === "hero50-source-v2-luna-revision-2" && plan.revision === candidate.revision && scope.revision === candidate.revision && sourceValues.revision === candidate.revision, "修订二版本标识未同步");
assert(candidate.counts.newParameters === 120 && candidate.counts.newFormulas === 24 && candidate.counts.newEffects === 26 && candidate.counts.newTotal === 170, "修订二新增计数不符");
assert(candidate.counts.protectedCurrentCompositionLists === 120 && candidate.counts.conceptualAllComponents === 290 && candidate.counts.totalComponentsIncludingProtected === 290 && candidate.counts.plannedTotalIncludingReused === 290, "修订二概念总组成应为290");
const revisionTwoRemovedIds = new Set(["udyr_q/standard_on_hit", "udyr_q/standard_max_health_hit", "udyr_q/empowered_max_health_hit", "udyr_r/pulse_damage"]);
assert(withheld.effects?.length === 4 && withheld.summary?.allNormalSaveSetFalse === true && withheld.summary?.allUnresolved === true, "四项待补效果证据不完整");
for (const item of withheld.effects) {
  const id = item.skillKey + "/" + item.effectKey;
  assert(revisionTwoRemovedIds.has(id) && item.normalSaveSet === false && item.proven === false && item.suggestedScope === null, "待补效果被错误决定为正常或已证：" + id);
  const baseEffect = baseCandidateForRevision.skills[item.skillKey]?.write.effects.find(effect => effect.effectKey === item.effectKey);
  assert(baseEffect && JSON.stringify(baseEffect) === JSON.stringify(item.originalEffect), "待补效果未保留修订一原始快照：" + id);
  const formulaKey = item.originalEffect.results?.[0]?.valueRule?.value?.formulaKey;
  assert(formulaKey && candidate.skills[item.skillKey].write.formulas.some(formula => formula.formulaKey === formulaKey), "撤出效果对应公式未保留：" + id);
}
for (const id of revisionTwoRemovedIds) {
  const [skillKey, effectKey] = id.split("/");
  assert(!candidate.skills[skillKey].write.effects.some(effect => effect.effectKey === effectKey), "撤出效果仍在候选：" + id);
  assert(!plan.requests.some(request => request.kind === "effects" && request.skillKey === skillKey && request.stableKey === effectKey), "撤出效果仍在请求计划：" + id);
  assert(!scope.skills[skillKey].recordableEffects.includes(effectKey), "撤出效果仍在范围正常集合：" + id);
  assert(!sourceValues.sourceValues[skillKey].selectedEffectKeys.includes(effectKey), "撤出效果仍在来源正常集合：" + id);
}
const asheQRevisionEffect = candidate.skills.ashe_q.write.effects.find(effect => effect.effectKey === "empowered_attack");
const asheQRevisionDamage = asheQRevisionEffect?.results?.find(result => result.resultKey === "damage");
assert(asheQRevisionDamage?.spellShieldBlockScope === null, "艾希Q强化攻击结果必须为null");
const candidateEffectKeyLists = Object.fromEntries(candidate.order.map(skillKey => [skillKey, candidate.skills[skillKey].write.effects.map(effect => effect.effectKey)]));
const sourceEffectKeyLists = Object.fromEntries(candidate.order.map(skillKey => [skillKey, sourceValues.sourceValues[skillKey]?.selectedEffectKeys || []]));
const sourceSelectedEffectConsistency = candidate.order.map(skillKey => ({ skillKey, candidate: candidateEffectKeyLists[skillKey], source: sourceEffectKeyLists[skillKey], pass: JSON.stringify(candidateEffectKeyLists[skillKey]) === JSON.stringify(sourceEffectKeyLists[skillKey]) }));
assert(sourceSelectedEffectConsistency.every(item => item.pass), "候选效果集合与来源选择不一致");
const planEffectConsistency = plan.requests.filter(request => request.kind === "effects").map(request => {
  const effect = candidate.skills[request.skillKey].write.effects.find(item => item.effectKey === request.stableKey);
  return { skillKey: request.skillKey, effectKey: request.stableKey, pass: Boolean(effect) && JSON.stringify(request.body) === JSON.stringify(effect) };
});
assert(planEffectConsistency.length === 26 && planEffectConsistency.every(item => item.pass), "请求计划效果载荷与候选不一致");
const protectedParameterRoutes = new Set((protection.requests || []).filter(item => /\/skills\/[^/]+\/parameters\//.test(item.route)).map(item => item.route));
const publicReuseProtectedChecks = reuseList.map(item => ({ skillKey: item.skillKey, parameterKey: item.parameterKey, route: "/skills/" + item.skillKey + "/parameters/" + item.parameterKey, pass: protectedParameterRoutes.has("/skills/" + item.skillKey + "/parameters/" + item.parameterKey) }));
assert(publicReuseProtectedChecks.length === 26 && publicReuseProtectedChecks.every(item => item.pass), "26项公共参数不是既有保护子集");
const parameterFormulaPreservation = candidate.order.map(skillKey => ({ skillKey, parameters: JSON.stringify(candidate.skills[skillKey].write.parameters) === JSON.stringify(baseCandidateForRevision.skills[skillKey].write.parameters), formulas: JSON.stringify(candidate.skills[skillKey].write.formulas) === JSON.stringify(baseCandidateForRevision.skills[skillKey].write.formulas) }));
assert(parameterFormulaPreservation.every(item => item.parameters && item.formulas), "修订二改变了修订一参数或公式");


const expectedExisting = { parameters: 79, formulas: 8, effects: 16, processes: 4, "internal-states": 0, "trigger-rules": 13 };
const existingSkills = ["udyr_q", "udyr_w", "udyr_e", "udyr_r", "azir_e", "azir_r", "ashe_q", "ashe_w", "ashe_r", "ez_p", "ez_q", "ez_w", "ez_e", "ez_r"];
const existingKinds = ["parameters", "formulas", "effects", "processes", "internal-states", "trigger-rules"];
const existingTotals = Object.fromEntries(existingKinds.map(kind => [kind, 0]));
for (const skillKey of existingSkills) for (const kind of existingKinds) {
  const rows = protectedByRoute.get(`/skills/${skillKey}/${kind}`)?.data;
  assert(Array.isArray(rows), `缺少已有组成保护：${skillKey}/${kind}`);
  existingTotals[kind] += rows.length;
}
assert(JSON.stringify(existingTotals) === JSON.stringify(expectedExisting), `已有组成总数漂移：${JSON.stringify(existingTotals)}`);
const protectedCompositionRoutes = [...protectedByRoute.keys()].filter(route => /\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(route));
assert(protectedCompositionRoutes.length === 120, `受保护组成列表数量不符：${protectedCompositionRoutes.length}`);
const expectedReuseKeys = new Set(reuseList.map(item => `${item.skillKey}/${item.parameterKey}`));
const actualReuseKeys = new Set(candidate.reusedPublicParameters.map(item => `${item.skillKey}/${item.parameterKey}`));
assert(actualReuseKeys.size === expectedReuseKeys.size && [...expectedReuseKeys].every(key => actualReuseKeys.has(key)), "公共参数复用键漂移");
assert(Array.isArray(candidate.reusedExistingParameters) && candidate.reusedExistingParameters.length === 0, "已有组成不应被重放");

const attributeItems = protectedByRoute.get("/attributes")?.data?.items || [];
const attributeKeys = new Set(attributeItems.map(item => item.attributeKey));
const allowedAttributes = new Set([
  "SOURCE/attack_damage/TOTAL", "SOURCE/attack_damage/BONUS", "SOURCE/ability_power/TOTAL",
  "SOURCE/hp/TOTAL", "SOURCE/hp/BONUS", "TARGET/hp/TOTAL",
  "SOURCE/critical_strike_chance/TOTAL", "SOURCE/critical_strike_damage_bonus_percent/TOTAL",
]);
for (const key of ["attack_damage", "ability_power", "hp", "bonus_attack_speed_percent", "move_speed_percent", "attack_range", "critical_strike_chance", "critical_strike_damage_bonus_percent", "life_steal_percent"]) assert(attributeKeys.has(key), `冻结属性目录缺少：${key}`);

const expectedParameters = new Map();
const sourceParameterSpecs = [];
const putExpected = (skillKey, parameterKey, mode, valueType, detail) => {
  const id = `${skillKey}/${parameterKey}`;
  assert(!expectedParameters.has(id), `独立源映射重复：${id}`);
  expectedParameters.set(id, { mode, valueType, ...detail });
};
const expectSkillData = (skillKey, parameterKey, valueType, heroId, slot, dataName, count, transform = value => value, transformName = "原值") => {
  const values = Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index + 1), norm(transform(dataAt(heroId, slot, dataName, index + 1)))]));
  putExpected(skillKey, parameterKey, "SKILL_LEVEL", valueType, { values });
  sourceParameterSpecs.push({ skillKey, parameterKey, sourceKind: "DataValue", heroId, slot, name: dataName, mode: "SKILL_LEVEL", sourceStart: 1, sourceEnd: count, transformName });
};
const expectDataFixed = (skillKey, parameterKey, valueType, heroId, slot, dataName, transform = value => value, transformName = "原值", index = 1) => {
  const value = norm(transform(dataAt(heroId, slot, dataName, index)));
  putExpected(skillKey, parameterKey, "FIXED", valueType, { value });
  sourceParameterSpecs.push({ skillKey, parameterKey, sourceKind: "DataValue", heroId, slot, name: dataName, mode: "FIXED", sourceIndex: index, transformName });
};
const expectFieldFixed = (skillKey, parameterKey, valueType, heroId, slot, fieldName, transform = value => value, transformName = "原值", index = 1) => {
  const value = norm(transform(fieldAt(heroId, slot, fieldName, index)));
  putExpected(skillKey, parameterKey, "FIXED", valueType, { value });
  sourceParameterSpecs.push({ skillKey, parameterKey, sourceKind: "field", heroId, slot, name: fieldName, mode: "FIXED", sourceIndex: index, transformName });
};
const expectFixed = (skillKey, parameterKey, valueType, value, source, transformName = "明确文本或树常量") => {
  putExpected(skillKey, parameterKey, "FIXED", valueType, { value: norm(value) });
  sourceParameterSpecs.push({ skillKey, parameterKey, sourceKind: "explicit", source, mode: "FIXED", transformName });
};
const expectRuntime = (skillKey, parameterKey, valueType, source) => {
  putExpected(skillKey, parameterKey, "RUNTIME_INPUT", valueType, {});
  sourceParameterSpecs.push({ skillKey, parameterKey, sourceKind: "runtime", source, mode: "RUNTIME_INPUT" });
};
const calcEndpointExpected = (skillKey, parameterKey, valueType, heroId, slot, calcName, endpointName, calcIndex = 0) => expectFixed(skillKey, parameterKey, valueType, endpoint(heroId, slot, calcName, calcIndex)[endpointName], `${heroId}/${slot}/${calcName} ${endpointName}`);

expectDataFixed("udyr_p", "attack_speed_duration_ms", "INTEGER", "Udyr", "P", "AttackSpeedDuration", toMs, "秒转整数毫秒");
expectDataFixed("udyr_p", "awakened_cooldown_return_ratio", "DECIMAL", "Udyr", "P", "UltCDReduction");
expectDataFixed("udyr_p", "awakened_cooldown_multiplier", "DECIMAL", "Udyr", "P", "UltCDMultiplier");
expectDataFixed("udyr_p", "stance_global_cooldown_ms", "INTEGER", "Udyr", "P", "GlobalCD", toMs, "秒转整数毫秒");
expectDataFixed("udyr_p", "awakened_global_cooldown_ms", "INTEGER", "Udyr", "P", "GlobalCDEmpowered", toMs, "秒转整数毫秒");
expectFixed("udyr_p", "attack_speed_ratio", "DECIMAL", numberPart("Udyr", "P", "AttackSpeed"), "Udyr/P/AttackSpeed mNumber");
expectFixed("udyr_p", "attack_count", "INTEGER", 2, "当前中文正文下两次攻击");
expectFixed("udyr_p", "ult_cd_base_ms", "INTEGER", toMs(calcPart("Udyr", "P", "UltCD").mLevel1Value), "Udyr/P/UltCD mLevel1Value", "秒转整数毫秒");
const udyrUltBreakpoints = Object.fromEntries((calcPart("Udyr", "P", "UltCD").mBreakpoints || []).map(item => [item.mLevel, toMsSigned(item.mAdditionalBonusAtThisLevel)]));
for (const level of [6, 11, 16]) expectFixed("udyr_p", `ult_cd_breakpoint_${level}_ms`, "INTEGER", udyrUltBreakpoints[level], `Udyr/P/UltCD ${level}级断点`, "秒转整数毫秒");

expectSkillData("udyr_q", "attack_speed_ratio", "DECIMAL", "Udyr", "Q", "AttackSpeedBase", 6);
expectDataFixed("udyr_q", "attack_speed_duration_ms", "INTEGER", "Udyr", "Q", "AttackSpeedDurationBase", toMs, "秒转整数毫秒");
expectDataFixed("udyr_q", "empowered_attack_speed_duration_ms", "INTEGER", "Udyr", "Q", "AttackSpeedDurationEmpowered", toMs, "秒转整数毫秒");
expectSkillData("udyr_q", "max_hp_on_hit_ratio", "DECIMAL", "Udyr", "Q", "MaxHPOnHitBase", 6);
expectSkillData("udyr_q", "base_damage", "INTEGER", "Udyr", "Q", "BaseDamage", 6);
expectSkillData("udyr_q", "on_hit_bonus_hp_ratio", "DECIMAL", "Udyr", "Q", "OnHitBonusHPRatio", 6);
expectDataFixed("udyr_q", "max_hp_ad_ratio", "DECIMAL", "Udyr", "Q", "MaxHPADRatio");
expectDataFixed("udyr_q", "empowered_max_hp_ad_ratio", "DECIMAL", "Udyr", "Q", "Q2MaxHPADRatio");
expectDataFixed("udyr_q", "lightning_ap_ratio", "DECIMAL", "Udyr", "Q", "LightningAPRatio");
expectDataFixed("udyr_q", "lightning_bounce_count", "INTEGER", "Udyr", "Q", "Bounces");
expectDataFixed("udyr_q", "lightning_bounce_range", "INTEGER", "Udyr", "Q", "BounceRange");
expectDataFixed("udyr_q", "repeat_bounce_penalty", "DECIMAL", "Udyr", "Q", "RepeatBouncePenalty");
const udyrBounceParts = calcPart("Udyr", "Q", "EmpoweredLightningBonusMax").mPart2;
expectFixed("udyr_q", "bounce_multiplier_base", "DECIMAL", nested(udyrBounceParts, ["mSubparts", 0, "mNumber"], "Udyr/Q/EmpoweredLightningBonusMax基准"), "Udyr/Q/EmpoweredLightningBonusMax树");
expectFixed("udyr_q", "bounce_count_subtract_one", "INTEGER", nested(udyrBounceParts, ["mSubparts", 1, "mPart1", "mSubparts", 1, "mNumber"], "Udyr/Q/EmpoweredLightningBonusMax减一"), "Udyr/Q/EmpoweredLightningBonusMax树");
expectDataFixed("udyr_q", "lightning_level_ratio_start", "DECIMAL", "Udyr", "Q", "LightningDamageLevel1");
expectDataFixed("udyr_q", "lightning_level_ratio_end", "DECIMAL", "Udyr", "Q", "LightningDamageLevel18");
expectDataFixed("udyr_q", "empowered_bonus_as_start", "DECIMAL", "Udyr", "Q", "EmpoweredBonusASLevel1");
expectDataFixed("udyr_q", "empowered_bonus_as_end", "DECIMAL", "Udyr", "Q", "EmpoweredBonusASLevel18");
calcEndpointExpected("udyr_q", "empowered_percent_hp_level_start", "DECIMAL", "Udyr", "Q", "Q2TotalOnHitHPDamage", "start", 1);
calcEndpointExpected("udyr_q", "empowered_percent_hp_level_end", "DECIMAL", "Udyr", "Q", "Q2TotalOnHitHPDamage", "end", 1);
expectFixed("udyr_q", "empowered_source_hp_ratio", "DECIMAL", coefficient("Udyr", "Q", "Q2TotalOnHitHPDamage", 3), "Udyr/Q/Q2TotalOnHitHPDamage第四分支");
expectDataFixed("udyr_q", "attack_range_bonus", "INTEGER", "Udyr", "Q", "AttackRange");
expectFieldFixed("udyr_q", "spell_cast_time_ms", "INTEGER", "Udyr", "Q", "spellCastTime", toMs, "秒转整数毫秒");
expectRuntime("udyr_q", "lightning_level_ratio_actual", "DECIMAL", "Udyr/Q/EmpoweredLightningBonus角色等级曲线");
expectRuntime("udyr_q", "empowered_bonus_as_actual", "DECIMAL", "Udyr/Q/EmpoweredTotalAS角色等级曲线");
expectRuntime("udyr_q", "empowered_percent_hp_level_actual", "DECIMAL", "Udyr/Q/Q2TotalOnHitHPDamage角色等级曲线");
expectRuntime("udyr_q", "actual_remaining_two_attack_range_qualification_duration_ms", "INTEGER", "Udyr/Q/下两次攻击实际剩余攻击距离资格时长");
expectFixed("udyr_q", "bonus_ad_ratio", "DECIMAL", coefficient("Udyr", "Q", "OnHitDamage", 1), "Udyr/Q/OnHitDamage额外攻击力分支");

expectDataFixed("udyr_w", "shield_duration_ms", "INTEGER", "Udyr", "W", "ShieldDuration", toMs, "秒转整数毫秒");
expectSkillData("udyr_w", "shield_base", "INTEGER", "Udyr", "W", "ShieldBase", 6);
expectSkillData("udyr_w", "shield_hp_ratio", "DECIMAL", "Udyr", "W", "ShieldPercentHealth", 6);
expectDataFixed("udyr_w", "shield_ap_ratio", "DECIMAL", "Udyr", "W", "ShieldAPRatio");
expectDataFixed("udyr_w", "life_on_hit_hp_ratio", "DECIMAL", "Udyr", "W", "LifeOnHitHPRatio");
expectDataFixed("udyr_w", "life_on_hit_ap_ratio", "DECIMAL", "Udyr", "W", "OnHitHealAPRatio");
expectSkillData("udyr_w", "life_steal_ratio", "DECIMAL", "Udyr", "W", "LifeSteal", 6);
expectDataFixed("udyr_w", "awakened_heal_attack_multiplier", "DECIMAL", "Udyr", "W", "HealAttackMult");
expectDataFixed("udyr_w", "awakened_total_heal_ratio", "DECIMAL", "Udyr", "W", "PercentOfShieldHealAmount");
expectFixed("udyr_w", "shield_bonus_ad_ratio", "DECIMAL", coefficient("Udyr", "W", "TotalShield", 3), "Udyr/W/TotalShield额外攻击力分支");
expectFixed("udyr_w", "awakened_shield_ap_ratio", "DECIMAL", coefficient("Udyr", "W", "RecastShield", 2), "Udyr/W/RecastShield法强分支");
expectFixed("udyr_w", "awakened_shield_hp_ratio", "DECIMAL", coefficient("Udyr", "W", "RecastShield", 3), "Udyr/W/RecastShield生命分支");
expectFixed("udyr_w", "awakened_shield_bonus_ad_ratio", "DECIMAL", coefficient("Udyr", "W", "RecastShield", 4), "Udyr/W/RecastShield额外攻击力分支");
calcEndpointExpected("udyr_w", "awakened_shield_level_start", "INTEGER", "Udyr", "W", "RecastShield", "start");
calcEndpointExpected("udyr_w", "awakened_shield_level_end", "INTEGER", "Udyr", "W", "RecastShield", "end");
expectSkillData("udyr_w", "awakened_shield_base_from_skill", "INTEGER", "Udyr", "W", "ShieldBase", 6);
expectFieldFixed("udyr_w", "spell_cast_time_ms", "INTEGER", "Udyr", "W", "spellCastTime", toMs, "秒转整数毫秒");
expectRuntime("udyr_w", "awakened_shield_level_actual", "DECIMAL", "Udyr/W/RecastShield角色等级曲线");
expectFixed("udyr_w", "attack_count", "INTEGER", 2, "当前中文正文下两次攻击");
expectRuntime("udyr_w", "actual_remaining_two_attack_qualification_duration_ms", "INTEGER", "Udyr/W/下两次攻击实际剩余资格时长");

expectSkillData("udyr_e", "target_icd_ms", "INTEGER", "Udyr", "E", "ICD", 6, toMs, "秒转整数毫秒");
expectSkillData("udyr_e", "base_move_speed_ratio", "DECIMAL", "Udyr", "E", "BaseMoveSpeed", 6);
expectDataFixed("udyr_e", "move_speed_duration_ms", "INTEGER", "Udyr", "E", "MoveSpeedDuration", toMs, "秒转整数毫秒");
expectDataFixed("udyr_e", "stun_duration_ms", "INTEGER", "Udyr", "E", "StunDuration", toMs, "秒转整数毫秒");
expectDataFixed("udyr_e", "unstoppable_duration_ms", "INTEGER", "Udyr", "E", "UnstoppableDuration", toMs, "秒转整数毫秒");
expectFixed("udyr_e", "move_speed_bonus_ad_ratio", "DECIMAL", coefficient("Udyr", "E", "MoveSpeed", 1), "Udyr/E/MoveSpeed额外攻击力分支");
expectFixed("udyr_e", "empowered_move_speed_ad_ratio", "DECIMAL", coefficient("Udyr", "E", "MoveSpeedBonus", 1), "Udyr/E/MoveSpeedBonus额外攻击力分支");
calcEndpointExpected("udyr_e", "empowered_move_speed_start_ratio", "DECIMAL", "Udyr", "E", "MoveSpeedBonus", "start");
calcEndpointExpected("udyr_e", "empowered_move_speed_end_ratio", "DECIMAL", "Udyr", "E", "MoveSpeedBonus", "end");
expectFixed("udyr_e", "attack_count_per_target", "INTEGER", 1, "当前中文正文每目标首次攻击");
expectFieldFixed("udyr_e", "spell_cast_time_ms", "INTEGER", "Udyr", "E", "spellCastTime", toMs, "秒转整数毫秒");
expectRuntime("udyr_e", "empowered_move_speed_level_actual", "DECIMAL", "Udyr/E/MoveSpeedBonus角色等级曲线");

expectDataFixed("udyr_r", "storm_duration_ms", "INTEGER", "Udyr", "R", "BuffDuration", toMs, "秒转整数毫秒");
expectSkillData("udyr_r", "slow_ratio", "DECIMAL", "Udyr", "R", "SlowPotency", 6);
expectDataFixed("udyr_r", "slow_duration_ms", "INTEGER", "Udyr", "R", "SlowDuration", toMs, "秒转整数毫秒");
expectSkillData("udyr_r", "storm_base_damage", "INTEGER", "Udyr", "R", "StormBaseDamage", 6);
expectDataFixed("udyr_r", "storm_ap_ratio", "DECIMAL", "Udyr", "R", "StormAPRatio");
expectFixed("udyr_r", "storm_damage_ap_ratio", "DECIMAL", coefficient("Udyr", "R", "StormDamage", 1), "Udyr/R/StormDamage法强分支");
expectFixed("udyr_r", "pulse_ap_ratio", "DECIMAL", coefficient("Udyr", "R", "PulseDamage", 1), "Udyr/R/PulseDamage法强分支");
calcEndpointExpected("udyr_r", "pulse_level_start", "INTEGER", "Udyr", "R", "PulseDamage", "start");
calcEndpointExpected("udyr_r", "pulse_level_end", "INTEGER", "Udyr", "R", "PulseDamage", "end");
calcEndpointExpected("udyr_r", "percent_hp_level_start_ratio", "DECIMAL", "Udyr", "R", "PercentHPBlast", "start");
calcEndpointExpected("udyr_r", "percent_hp_level_end_ratio", "DECIMAL", "Udyr", "R", "PercentHPBlast", "end");
expectFixed("udyr_r", "empowered_slow_ratio", "DECIMAL", numberPart("Udyr", "R", "EmpoweredSlow"), "Udyr/R/EmpoweredSlow固定数值");
expectFixed("udyr_r", "storm_tick_interval_ms", "INTEGER", 1000, "当前中文正文每秒伤害", "秒转整数毫秒");
expectFixed("udyr_r", "pulse_attack_count", "INTEGER", 2, "当前中文正文下两次攻击");
expectFieldFixed("udyr_r", "m_cast_time_ms", "INTEGER", "Udyr", "R", "mCastTime", toMs, "秒转整数毫秒", 0);
expectFieldFixed("udyr_r", "spell_cast_time_ms", "INTEGER", "Udyr", "R", "spellCastTime", toMs, "秒转整数毫秒");
expectRuntime("udyr_r", "pulse_level_actual", "DECIMAL", "Udyr/R/PulseDamage角色等级曲线");
expectRuntime("udyr_r", "percent_hp_level_actual_ratio", "DECIMAL", "Udyr/R/PercentHPBlast角色等级曲线");

expectSkillData("azir_e", "base_damage", "INTEGER", "Azir", "E", "BaseDamage", 5);
expectDataFixed("azir_e", "damage_ap_ratio", "DECIMAL", "Azir", "E", "DamageRatio");
expectSkillData("azir_e", "base_shield", "INTEGER", "Azir", "E", "BaseShield", 5);
expectDataFixed("azir_e", "shield_ap_ratio", "DECIMAL", "Azir", "E", "ShieldAPRatio");
expectDataFixed("azir_e", "dash_speed", "INTEGER", "Azir", "E", "DashSpeed");
expectDataFixed("azir_e", "shield_duration_ms", "INTEGER", "Azir", "E", "ShieldDuration", toMs, "秒转整数毫秒");
expectDataFixed("azir_e", "soldier_qualification_range", "INTEGER", "Azir", "E", "CastRange");
expectFieldFixed("azir_e", "display_range", "INTEGER", "Azir", "E", "castRangeDisplayOverride");

expectSkillData("azir_r", "base_damage", "INTEGER", "Azir", "R", "BaseDamage", 3);
expectFixed("azir_r", "ap_ratio", "DECIMAL", coefficient("Azir", "R", "TotalDamage", 1), "Azir/R/TotalDamage法强分支");
expectDataFixed("azir_r", "wall_duration_ms", "INTEGER", "Azir", "R", "WallDuration", toMs, "秒转整数毫秒");
expectSkillData("azir_r", "wall_construct_count", "INTEGER", "Azir", "R", "NumberOfSoldiers", 3);
expectFieldFixed("azir_r", "cast_time_ms", "INTEGER", "Azir", "R", "mCastTime", toMs, "秒转整数毫秒", 0);
expectFieldFixed("azir_r", "display_range", "INTEGER", "Azir", "R", "castRangeDisplayOverride");

expectDataFixed("ashe_p", "slow_duration_ms", "INTEGER", "Ashe", "P", "SlowDuration", toMs, "秒转整数毫秒");
const asheDamageBonus = calc("Ashe", "P", "DamageBonus");
expectFixed("ashe_p", "slow_start_ratio", "DECIMAL", endpoint("Ashe", "P", "SlowAmount").start, "Ashe/P/SlowAmount角色等级起点");
expectFixed("ashe_p", "slow_end_ratio", "DECIMAL", endpoint("Ashe", "P", "SlowAmount").end, "Ashe/P/SlowAmount角色等级终点");
expectFixed("ashe_p", "empowered_slow_start_ratio", "DECIMAL", endpoint("Ashe", "P", "EmpoweredSlowAmount").start, "Ashe/P/EmpoweredSlowAmount角色等级起点");
expectFixed("ashe_p", "empowered_slow_end_ratio", "DECIMAL", endpoint("Ashe", "P", "EmpoweredSlowAmount").end, "Ashe/P/EmpoweredSlowAmount角色等级终点");
expectRuntime("ashe_p", "slow_ratio_actual", "DECIMAL", "Ashe/P/SlowAmount角色等级曲线");
expectRuntime("ashe_p", "empowered_slow_ratio_actual", "DECIMAL", "Ashe/P/EmpoweredSlowAmount角色等级曲线");
expectFixed("ashe_p", "crit_base_multiplier", "DECIMAL", nested(asheDamageBonus, ["mFormulaParts", 0, "mNumber"], "Ashe/P/DamageBonus基准"), "Ashe/P/DamageBonus前导1");
expectFixed("ashe_p", "crit_subpart_base", "DECIMAL", nested(asheDamageBonus, ["mFormulaParts", 1, "mSubpart", "mSubparts", 0, "mNumber"], "Ashe/P/DamageBonus子树基准"), "Ashe/P/DamageBonus子树");
expectFixed("ashe_p", "crit_subpart_coefficient", "DECIMAL", nested(asheDamageBonus, ["mFormulaParts", 1, "mSubpart", "mSubparts", 1, "mCoefficient"], "Ashe/P/DamageBonus暴击伤害系数"), "Ashe/P/DamageBonus子树");

expectSkillData("ashe_q", "damage_per_strike", "DECIMAL", "Ashe", "Q", "DamagePerStrike", 5);
expectDataFixed("ashe_q", "shots_per_strike", "INTEGER", "Ashe", "Q", "ShotsPerStrike");
expectDataFixed("ashe_q", "stack_duration_ms", "INTEGER", "Ashe", "Q", "StackDuration", toMs, "秒转整数毫秒");
expectDataFixed("ashe_q", "max_stacks", "INTEGER", "Ashe", "Q", "MaxStacks");
expectDataFixed("ashe_q", "buff_duration_ms", "INTEGER", "Ashe", "Q", "BuffDuration", toMs, "秒转整数毫秒");
expectSkillData("ashe_q", "bonus_attack_speed_ratio", "DECIMAL", "Ashe", "Q", "BonusAS", 5, value => value / 100, "百分数点转比例");
expectFieldFixed("ashe_q", "spell_cast_time_ms", "INTEGER", "Ashe", "Q", "spellCastTime", toMs, "秒转整数毫秒");

const parameterChecks = [];
const integerChecks = [];
for (const skillKey of candidate.order) {
  const skillData = candidate.skills[skillKey];
  const maxLevel = protectedSkill(skillKey).maxLevel;
  assert(skillData.maxLevel === maxLevel, `候选最高等级漂移：${skillKey}`);
  for (const parameter of skillData.write.parameters) {
    const id = `${skillKey}/${parameter.parameterKey}`;
    const expectedDefinition = expectedParameters.get(id);
    assert(expectedDefinition, `没有独立源值映射：${id}`);
    let pass = parameter.valueMode === expectedDefinition.mode && parameter.valueType === expectedDefinition.valueType;
    const detail = { skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, expectedMode: expectedDefinition.mode, valueType: parameter.valueType, expectedValueType: expectedDefinition.valueType };
    if (expectedDefinition.mode === "FIXED") {
      detail.actual = parameter.fixedValue; detail.expected = expectedDefinition.value;
      pass = pass && parameter.fixedValue !== null && parameter.levelValues === null && typeof parameter.fixedValue === "number" && Number.isFinite(parameter.fixedValue) && equal(parameter.fixedValue, expectedDefinition.value);
    } else if (expectedDefinition.mode === "SKILL_LEVEL") {
      detail.actual = parameter.levelValues; detail.expected = expectedDefinition.values;
      const expectedKeys = Object.keys(expectedDefinition.values);
      const actualKeys = Object.keys(parameter.levelValues || {});
      pass = pass && parameter.fixedValue === null && JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) && expectedKeys.every(key => equal(parameter.levelValues[key], expectedDefinition.values[key]));
    } else {
      pass = pass && parameter.fixedValue === null && parameter.levelValues === null;
    }
    parameterChecks.push({ ...detail, pass });
    const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
    const finiteOk = parameter.valueMode === "RUNTIME_INPUT" ? parameter.fixedValue === null && parameter.levelValues === null : values.every(value => typeof value === "number" && Number.isFinite(value));
    const integerOk = parameter.valueType !== "INTEGER" || parameter.valueMode === "RUNTIME_INPUT" || values.every(value => Number.isInteger(value));
    const msOk = !parameter.parameterKey.endsWith("_ms") || parameter.valueMode === "RUNTIME_INPUT" || values.every(value => Number.isInteger(value));
    integerChecks.push({ skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, finiteOk, integerOk, msOk, pass: finiteOk && integerOk && msOk });
  }
}
assert(expectedParameters.size === parameterChecks.length, `候选参数数量或映射数量不符：${parameterChecks.length}/${expectedParameters.size}`);
assert(parameterChecks.every(item => item.pass), `参数源值核对失败：${JSON.stringify(parameterChecks.filter(item => !item.pass).slice(0, 4))}`);
assert(integerChecks.every(item => item.pass), `整数或毫秒参数核对失败：${JSON.stringify(integerChecks.filter(item => !item.pass).slice(0, 4))}`);

const sourceParameterChecks = sourceParameterSpecs.map(spec => {
  const parameter = parameterOf(spec.skillKey, spec.parameterKey);
  const expectedDefinition = expectedParameters.get(`${spec.skillKey}/${spec.parameterKey}`);
  let pass = Boolean(parameter) && parameter.valueMode === spec.mode;
  const detail = { ...spec, candidateMode: parameter?.valueMode || null, pass };
  if (pass && spec.mode === "FIXED" && spec.sourceKind !== "explicit" && spec.sourceKind !== "runtime") {
    const raw = spec.sourceKind === "DataValue" ? dataAt(spec.heroId, spec.slot, spec.name, spec.sourceIndex) : fieldAt(spec.heroId, spec.slot, spec.name, spec.sourceIndex);
    const transform = spec.transformName === "秒转整数毫秒" ? toMs : spec.transformName === "百分数点转比例" ? value => value / 100 : value => value;
    detail.sourceValue = raw; detail.candidateValue = parameter.fixedValue; detail.expected = norm(transform(raw));
    pass = pass && equal(parameter.fixedValue, detail.expected);
  } else if (pass && spec.mode === "SKILL_LEVEL") {
    const values = expectedDefinition.values;
    const lastKey = String(Object.keys(values).length);
    detail.candidateLevel1 = parameter.levelValues?.["1"]; detail.candidateLast = parameter.levelValues?.[lastKey]; detail.expectedLevel1 = values["1"]; detail.expectedLast = values[lastKey];
    pass = pass && JSON.stringify(Object.keys(parameter.levelValues || {})) === JSON.stringify(Object.keys(values)) && Object.keys(values).every(key => equal(parameter.levelValues[key], values[key]));
  }
  detail.pass = pass;
  return detail;
});
assert(sourceParameterChecks.every(item => item.pass), `源参数映射失败：${JSON.stringify(sourceParameterChecks.filter(item => !item.pass).slice(0, 4))}`);

const parameterMap = (skillKey, skillLevel, characterLevel, inputs = {}) => {
  const values = {};
  for (const parameter of candidate.skills[skillKey].write.parameters) {
    if (parameter.valueMode === "FIXED") values[parameter.parameterKey] = need(parameter, "fixedValue", `固定参数${skillKey}/${parameter.parameterKey}`);
    else if (parameter.valueMode === "SKILL_LEVEL") values[parameter.parameterKey] = need(parameter.levelValues, String(skillLevel), `技能等级参数${skillKey}/${parameter.parameterKey}/${skillLevel}`);
    else if (parameter.valueMode === "CHARACTER_LEVEL") values[parameter.parameterKey] = need(parameter.levelValues, String(characterLevel), `角色等级参数${skillKey}/${parameter.parameterKey}/${characterLevel}`);
    else if (parameter.valueMode === "RUNTIME_INPUT") values[parameter.parameterKey] = need(inputs, parameter.parameterKey, `运行输入${skillKey}/${parameter.parameterKey}`);
    else throw new Error(`未知参数模式：${skillKey}/${parameter.parameterKey}`);
  }
  for (const item of publicParametersFor(skillKey)) {
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
    hp: { TOTAL: scenario.sourceMaxHP, BONUS: scenario.sourceBonusHP },
    critical_strike_chance: { TOTAL: scenario.critChance },
    critical_strike_damage_bonus_percent: { TOTAL: scenario.critDamageBonus },
  },
  TARGET: { hp: { TOTAL: scenario.targetMaxHP } },
});
const scenarioFor = (skillKey, index) => ({
  skillKey,
  rank: candidate.skills[skillKey].maxLevel > 1 ? (index === 0 ? 1 : candidate.skills[skillKey].maxLevel) : 1,
  characterLevel: index === 0 ? 1 : 18,
  totalAD: index === 0 ? 220 : 420,
  bonusAD: index === 0 ? 100 : 240,
  AP: index === 0 ? 130 : 480,
  sourceMaxHP: index === 0 ? 2600 : 3800,
  sourceBonusHP: index === 0 ? 600 : 1400,
  targetMaxHP: index === 0 ? 1400 : 2600,
  critChance: index === 0 ? 0.25 : 0.65,
  critDamageBonus: index === 0 ? 0.4 : 0.6,
  inputs: {
    lightning_level_ratio_actual: index === 0 ? 0.015 : 0.03,
    empowered_bonus_as_actual: index === 0 ? 0.2 : 0.7,
    empowered_percent_hp_level_actual: index === 0 ? 0.02 : 0.04,
    awakened_shield_level_actual: index === 0 ? 20 : 150,
    empowered_move_speed_level_actual: index === 0 ? 0.3 : 0.4,
    pulse_level_actual: index === 0 ? 10 : 40,
    percent_hp_level_actual_ratio: index === 0 ? 0.08 : 0.14,
    actual_remaining_two_attack_qualification_duration_ms: index === 0 ? 3200 : 700,
    actual_remaining_two_attack_range_qualification_duration_ms: index === 0 ? 3100 : 650,
    slow_ratio_actual: index === 0 ? 0.2 : 0.3,
    empowered_slow_ratio_actual: index === 0 ? 0.4 : 0.6,
  },
});
const evaluate = (node, params, attrs) => {
  if (!node || typeof node !== "object") throw new Error("公式节点为空");
  if (node.nodeType === "PARAMETER") return need(params, node.parameterKey, `公式参数${node.parameterKey}`);
  if (node.nodeType === "ATTRIBUTE") {
    const attributePath = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`;
    if (!allowedAttributes.has(attributePath) || !attributeKeys.has(node.attributeKey)) throw new Error(`属性枚举未证：${attributePath}`);
    const value = attrs[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`缺少属性${attributePath}`);
    return value;
  }
  if (node.nodeType === "OPERATION") {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw new Error("操作数不是恰好两个");
    const [left, right] = node.operands.map(child => evaluate(child, params, attrs));
    let result;
    if (node.operation === "ADD") result = left + right;
    else if (node.operation === "SUBTRACT") result = left - right;
    else if (node.operation === "MULTIPLY") result = left * right;
    else if (node.operation === "DIVIDE") { if (right === 0) throw new Error("除数为零"); result = left / right; }
    else throw new Error(`未知二元运算：${node.operation}`);
    if (!Number.isFinite(result)) throw new Error(`公式结果不是有限数字：${result}`);
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

const expected = (skillKey, formulaKey, scenario) => {
  const { rank, AP, bonusAD, totalAD, sourceMaxHP, sourceBonusHP, targetMaxHP, critChance, critDamageBonus, inputs } = scenario;
  const dv = (heroId, slot, name) => dataAt(heroId, slot, name, rank);
  switch (`${skillKey}/${formulaKey}`) {
    case "udyr_q/on_hit_physical_damage": return dv("Udyr", "Q", "BaseDamage") + coefficient("Udyr", "Q", "OnHitDamage", 1) * bonusAD + dv("Udyr", "Q", "OnHitBonusHPRatio") * sourceBonusHP;
    case "udyr_q/standard_max_health_physical_damage": return (dv("Udyr", "Q", "MaxHPOnHitBase") + dv("Udyr", "Q", "MaxHPADRatio") * bonusAD) * targetMaxHP;
    case "udyr_q/empowered_max_health_physical_damage": return (dv("Udyr", "Q", "MaxHPOnHitBase") + inputs.empowered_percent_hp_level_actual + dv("Udyr", "Q", "Q2MaxHPADRatio") * bonusAD + coefficient("Udyr", "Q", "Q2TotalOnHitHPDamage", 3) * sourceBonusHP) * targetMaxHP;
    case "udyr_q/empowered_total_attack_speed_ratio": return dv("Udyr", "Q", "AttackSpeedBase") + inputs.empowered_bonus_as_actual;
    case "udyr_q/empowered_lightning_single_magic_damage": return (inputs.lightning_level_ratio_actual + dv("Udyr", "Q", "LightningAPRatio") * AP) * targetMaxHP;
    case "udyr_q/lightning_bounce_multiplier": return 1 + (dv("Udyr", "Q", "Bounces") - 1) * dv("Udyr", "Q", "RepeatBouncePenalty");
    case "udyr_q/empowered_lightning_total_magic_damage": return (inputs.lightning_level_ratio_actual + dv("Udyr", "Q", "LightningAPRatio") * AP) * targetMaxHP * (1 + (dv("Udyr", "Q", "Bounces") - 1) * dv("Udyr", "Q", "RepeatBouncePenalty"));
    case "udyr_w/normal_shield": return dv("Udyr", "W", "ShieldBase") + dv("Udyr", "W", "ShieldPercentHealth") * sourceMaxHP + dv("Udyr", "W", "ShieldAPRatio") * AP + coefficient("Udyr", "W", "TotalShield", 3) * bonusAD;
    case "udyr_w/life_on_hit_heal": return dv("Udyr", "W", "LifeOnHitHPRatio") * sourceMaxHP + dv("Udyr", "W", "OnHitHealAPRatio") * AP;
    case "udyr_w/awakened_shield": return inputs.awakened_shield_level_actual + dv("Udyr", "W", "ShieldBase") + coefficient("Udyr", "W", "RecastShield", 2) * AP + coefficient("Udyr", "W", "RecastShield", 3) * sourceMaxHP + coefficient("Udyr", "W", "RecastShield", 4) * bonusAD;
    case "udyr_w/awakened_total_heal": return (inputs.awakened_shield_level_actual + dv("Udyr", "W", "ShieldBase") + coefficient("Udyr", "W", "RecastShield", 2) * AP + coefficient("Udyr", "W", "RecastShield", 3) * sourceMaxHP + coefficient("Udyr", "W", "RecastShield", 4) * bonusAD) * dv("Udyr", "W", "PercentOfShieldHealAmount");
    case "udyr_w/awakened_on_hit_heal": return (dv("Udyr", "W", "LifeOnHitHPRatio") * sourceMaxHP + dv("Udyr", "W", "OnHitHealAPRatio") * AP) * dv("Udyr", "W", "HealAttackMult");
    case "udyr_w/awakened_life_steal_ratio": return dv("Udyr", "W", "LifeSteal") * dv("Udyr", "W", "HealAttackMult");
    case "udyr_e/base_move_speed_ratio": return dv("Udyr", "E", "BaseMoveSpeed") + coefficient("Udyr", "E", "MoveSpeed", 1) * bonusAD;
    case "udyr_e/empowered_move_speed_ratio": return inputs.empowered_move_speed_level_actual + coefficient("Udyr", "E", "MoveSpeedBonus", 1) * bonusAD;
    case "udyr_r/storm_damage_per_second": return dv("Udyr", "R", "StormBaseDamage") + coefficient("Udyr", "R", "StormDamage", 1) * AP;
    case "udyr_r/pulse_damage": return inputs.pulse_level_actual + coefficient("Udyr", "R", "PulseDamage", 1) * AP;
    case "udyr_r/empowered_percent_hp_damage": return (inputs.percent_hp_level_actual_ratio + dv("Udyr", "R", "StormAPRatio") * AP) * targetMaxHP;
    case "azir_e/shield": return dv("Azir", "E", "BaseShield") + dv("Azir", "E", "ShieldAPRatio") * AP;
    case "azir_e/magic_damage": return dv("Azir", "E", "BaseDamage") + dv("Azir", "E", "DamageRatio") * AP;
    case "azir_r/magic_damage": return dv("Azir", "R", "BaseDamage") + coefficient("Azir", "R", "TotalDamage", 1) * AP;
    case "ashe_p/damage_bonus_multiplier": return 1 + critChance * (nested(asheDamageBonus, ["mFormulaParts", 1, "mSubpart", "mSubparts", 0, "mNumber"], "Ashe/P/DamageBonus子树基准") + nested(asheDamageBonus, ["mFormulaParts", 1, "mSubpart", "mSubparts", 1, "mCoefficient"], "Ashe/P/DamageBonus暴击伤害系数") * critDamageBonus);
    case "ashe_p/modified_attack_damage": return totalAD * (1 + critChance * (nested(asheDamageBonus, ["mFormulaParts", 1, "mSubpart", "mSubparts", 0, "mNumber"], "Ashe/P/DamageBonus子树基准") + nested(asheDamageBonus, ["mFormulaParts", 1, "mSubpart", "mSubparts", 1, "mCoefficient"], "Ashe/P/DamageBonus暴击伤害系数") * critDamageBonus));
    case "ashe_q/empowered_attack_damage": return dv("Ashe", "Q", "DamagePerStrike") * totalAD;
    default: throw new Error(`缺少独立期望侧映射：${skillKey}/${formulaKey}`);
  }
};

const formulaTreeSpecs = [
  ["udyr_q", "on_hit_physical_damage", "Udyr", "Q", "OnHitDamage"], ["udyr_q", "standard_max_health_physical_damage", "Udyr", "Q", "MaxHPOnHit1"], ["udyr_q", "empowered_max_health_physical_damage", "Udyr", "Q", "Q2TotalOnHitHPDamage"], ["udyr_q", "empowered_total_attack_speed_ratio", "Udyr", "Q", "EmpoweredTotalAS"], ["udyr_q", "empowered_lightning_single_magic_damage", "Udyr", "Q", "EmpoweredLightningBonus"], ["udyr_q", "lightning_bounce_multiplier", "Udyr", "Q", "EmpoweredLightningBonusMax"], ["udyr_q", "empowered_lightning_total_magic_damage", "Udyr", "Q", "EmpoweredLightningBonusMax"],
  ["udyr_w", "normal_shield", "Udyr", "W", "TotalShield"], ["udyr_w", "life_on_hit_heal", "Udyr", "W", "LifeOnHit"], ["udyr_w", "awakened_shield", "Udyr", "W", "RecastShield"], ["udyr_w", "awakened_total_heal", "Udyr", "W", "RecastHeal"], ["udyr_w", "awakened_on_hit_heal", "Udyr", "W", "LifeOnHitAwakened"], ["udyr_w", "awakened_life_steal_ratio", "Udyr", "W", "{5fcd3b84}"],
  ["udyr_e", "base_move_speed_ratio", "Udyr", "E", "MoveSpeed"], ["udyr_e", "empowered_move_speed_ratio", "Udyr", "E", "MoveSpeedBonus"],
  ["udyr_r", "storm_damage_per_second", "Udyr", "R", "StormDamage"], ["udyr_r", "pulse_damage", "Udyr", "R", "PulseDamage"], ["udyr_r", "empowered_percent_hp_damage", "Udyr", "R", "PercentHPBlast"],
  ["azir_e", "shield", "Azir", "E", "TotalShield"], ["azir_e", "magic_damage", "Azir", "E", "TotalDamage"], ["azir_r", "magic_damage", "Azir", "R", "TotalDamage"],
  ["ashe_p", "damage_bonus_multiplier", "Ashe", "P", "DamageBonus"], ["ashe_p", "modified_attack_damage", "Ashe", "P", "{da9201cc}"], ["ashe_q", "empowered_attack_damage", "Ashe", "Q", "EmpoweredDamage"],
];
const formulaTreeChecks = formulaTreeSpecs.map(([skillKey, formulaKey, heroId, slot, treeName]) => {
  const formulaData = candidate.skills[skillKey]?.write.formulas.find(item => item.formulaKey === formulaKey);
  const rawTree = calc(heroId, slot, treeName);
  return { skillKey, formulaKey, source: `${heroId}/${slot}/${treeName}`, sourceTreeSha256: sha256(JSON.stringify(rawTree)), candidateFormula: Boolean(formulaData), sourceTreePresent: Boolean(rawTree), pass: Boolean(formulaData && rawTree) };
});
assert(formulaTreeChecks.length === candidate.counts.newFormulas && formulaTreeChecks.every(item => item.pass), `公式源树覆盖失败：${JSON.stringify(formulaTreeChecks.filter(item => !item.pass))}`);

const damageTypeItems = protectedByRoute.get("/damage-types")?.data?.items || [];
const modifierZoneItems = protectedByRoute.get("/modifier-zones")?.data?.items || [];
const damageTypeKeys = new Set(damageTypeItems.map(item => item.damageTypeKey));
const modifierZoneKeys = new Set(modifierZoneItems.map(item => item.modifierZoneKey));
const resultTypes = new Set(["DAMAGE", "DIRECT_HEAL", "NORMAL_SHIELD", "ATTRIBUTE_CHANGE", "RESOURCE_CHANGE", "COOLDOWN_CHANGE", "STATUS_OPERATION", "LIFECYCLE_OPERATION", "DAMAGE_MODIFIER", "HEALING_MODIFIER", "DAMAGE_IMMUNITY", "HEALTH_FLOOR", "SPELL_SHIELD", "EXECUTE", "HIT_LINK_APPLICATION", "ATTACK_LINK_APPLICATION", "SKILL_HASTE_MODIFIER"]);
const targetKinds = new Set(["SOURCE", "TARGET"]);
const deliveryKinds = new Set(["SKILL", "BASIC_ATTACK"]);
const originKinds = new Set(["DIRECT", "REFLECTED"]);
const criticalModes = new Set(["DISALLOWED", "SOURCE_CRIT_CHANCE", "FORCED"]);
const shieldDecayModes = new Set(["NONE", "LINEAR_TO_ZERO"]);
const attributeOperations = new Set(["INCREASE", "DECREASE", "SET"]);
const resourceOperations = new Set(["RESTORE", "CONSUME", "REFUND"]);
const enumChecks = [];
for (const skillKey of candidate.order) for (const effect of candidate.skills[skillKey].write.effects) for (const result of effect.results || []) {
  let pass = resultTypes.has(result.resultType) && targetKinds.has(result.target);
  const detail = result.detail || {};
  if (result.resultType === "DAMAGE") pass = pass && damageTypeKeys.has(detail.damageTypeKey) && deliveryKinds.has(detail.deliveryKind) && originKinds.has(detail.originKind) && criticalModes.has(detail.critical?.mode) && Array.isArray(detail.vampRules);
  if (result.resultType === "NORMAL_SHIELD") pass = pass && (detail.absorbedDamageTypeKey === null || damageTypeKeys.has(detail.absorbedDamageTypeKey)) && shieldDecayModes.has(detail.decayMode);
  if (result.resultType === "ATTRIBUTE_CHANGE") pass = pass && attributeKeys.has(detail.attributeKey) && attributeOperations.has(detail.operation) && (detail.modifierZoneKey === null || modifierZoneKeys.has(detail.modifierZoneKey));
  if (result.resultType === "RESOURCE_CHANGE") pass = pass && attributeKeys.has(detail.attributeKey) && resourceOperations.has(detail.operation);
  if (Object.prototype.hasOwnProperty.call(detail, "modifierZoneKey")) pass = pass && (detail.modifierZoneKey === null || modifierZoneKeys.has(detail.modifierZoneKey));
  if (Object.prototype.hasOwnProperty.call(detail, "statusKey")) pass = pass && typeof detail.statusKey === "string" && detail.statusKey.length > 0;
  enumChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, resultType: result.resultType, damageTypeKey: detail.damageTypeKey ?? null, absorbedDamageTypeKey: detail.absorbedDamageTypeKey ?? null, modifierZoneKey: detail.modifierZoneKey ?? null, statusKey: detail.statusKey ?? null, pass });
}
assert(damageTypeKeys.has("physics") && damageTypeKeys.has("magic") && damageTypeKeys.has("real"), "冻结伤害类型字典缺少physics/magic/real");
assert(modifierZoneKeys.has("attribute_flat_add"), "冻结乘区字典缺少attribute_flat_add");
assert(enumChecks.length === candidate.counts.newEffects && enumChecks.every(item => item.pass), `效果枚举核对失败：${JSON.stringify(enumChecks.filter(item => !item.pass).slice(0, 4))}`);

const formulaStructureChecks = [];
for (const skillKey of candidate.order) {
  const skillData = candidate.skills[skillKey];
  const localParameters = new Set(skillData.write.parameters.map(item => item.parameterKey));
  const publicParameters = new Set(publicParametersFor(skillKey).map(item => item.parameterKey));
  for (const formulaData of skillData.write.formulas) {
    const refs = refsOf(formulaData.expression);
    let pass = refs.length > 0;
    walk(formulaData.expression, node => {
      if (!["PARAMETER", "ATTRIBUTE", "OPERATION"].includes(node.nodeType)) pass = false;
      if (node.nodeType === "PARAMETER" && !localParameters.has(node.parameterKey) && !publicParameters.has(node.parameterKey)) pass = false;
      if (node.nodeType === "ATTRIBUTE") pass = pass && allowedAttributes.has(`${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`) && attributeKeys.has(node.attributeKey);
      if (node.nodeType === "OPERATION") pass = pass && Array.isArray(node.operands) && node.operands.length === 2 && ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"].includes(node.operation);
    });
    formulaStructureChecks.push({ skillKey, formulaKey: formulaData.formulaKey, parameterRefs: refs, pass });
  }
}
assert(formulaStructureChecks.length === candidate.counts.newFormulas && formulaStructureChecks.every(item => item.pass), `公式结构核对失败：${JSON.stringify(formulaStructureChecks.filter(item => !item.pass).slice(0, 4))}`);

const formulaResults = [];
const formulaMissingCases = [];
const runtimeMissingCases = [];
for (const skillKey of candidate.order) for (const formulaData of candidate.skills[skillKey].write.formulas) {
  const refs = refsOf(formulaData.expression);
  for (const index of [0, 1]) {
    const scenario = scenarioFor(skillKey, index);
    try {
      const actual = evaluate(formulaData.expression, parameterMap(skillKey, scenario.rank, scenario.characterLevel, scenario.inputs), attrsFor(scenario));
      const expectedValue = expected(skillKey, formulaData.formulaKey, scenario);
      formulaResults.push({ skillKey, formulaKey: formulaData.formulaKey, scene: index === 0 ? "基础场景" : "强化场景", rank: scenario.rank, characterLevel: scenario.characterLevel, actual: round(actual), expected: round(expectedValue), pass: equal(actual, expectedValue) });
    } catch (error) {
      formulaResults.push({ skillKey, formulaKey: formulaData.formulaKey, scene: index === 0 ? "基础场景" : "强化场景", pass: false, error: error.message });
    }
  }
  assert(refs.length > 0, `公式无参数引用，无法做缺值拒绝：${skillKey}/${formulaData.formulaKey}`);
  const scenario = scenarioFor(skillKey, 0);
  const params = parameterMap(skillKey, scenario.rank, scenario.characterLevel, scenario.inputs);
  const missingParameterKey = refs[0];
  delete params[missingParameterKey];
  let rejected = false; let error = null;
  try { evaluate(formulaData.expression, params, attrsFor(scenario)); } catch (caught) { rejected = true; error = caught.message; }
  formulaMissingCases.push({ skillKey, formulaKey: formulaData.formulaKey, missingParameterKey, rejected, error });
  for (const ref of refs.filter(key => parameterOf(skillKey, key)?.valueMode === "RUNTIME_INPUT")) {
    const inputs = { ...scenario.inputs }; delete inputs[ref];
    let runtimeRejected = false; let runtimeError = null;
    try { evaluate(formulaData.expression, parameterMap(skillKey, scenario.rank, scenario.characterLevel, inputs), attrsFor(scenario)); } catch (caught) { runtimeRejected = true; runtimeError = caught.message; }
    runtimeMissingCases.push({ skillKey, formulaKey: formulaData.formulaKey, missingParameterKey: ref, rejected: runtimeRejected, error: runtimeError });
  }
}
assert(formulaResults.length === candidate.counts.newFormulas * 2 && formulaResults.every(item => item.pass), `公式数学核算失败：${JSON.stringify(formulaResults.filter(item => !item.pass).slice(0, 4))}`);
assert(formulaMissingCases.length === candidate.counts.newFormulas && formulaMissingCases.every(item => item.rejected), "公式缺值没有全部严格拒绝");
assert(runtimeMissingCases.length > 0 && runtimeMissingCases.every(item => item.rejected), "运行输入缺值没有全部严格拒绝");

const effectStructureChecks = [];
const effectValueChecks = [];
const ratioAttributeChecks = [];
for (const skillKey of candidate.order) {
  const skillData = candidate.skills[skillKey];
  const localParameters = new Set(skillData.write.parameters.map(item => item.parameterKey));
  const localFormulas = new Set(skillData.write.formulas.map(item => item.formulaKey));
  const publicParameters = new Set(publicParametersFor(skillKey).map(item => item.parameterKey));
  for (const effect of skillData.write.effects) for (const result of effect.results || []) {
    const valueRule = result.valueRule;
    const value = valueRule?.value;
    let pass = Boolean(valueRule && valueRule.fixedMultiplier === 1 && valueRule.fixedMinValue === 0 && valueRule.fixedMaxValue === null);
    if (value?.kind === "FORMULA") pass = pass && localFormulas.has(value.formulaKey);
    else if (value?.kind === "PARAMETER") pass = pass && (localParameters.has(value.parameterKey) || publicParameters.has(value.parameterKey));
    else pass = false;
    const durationKey = effect.lifecycle?.durationValue?.kind === "PARAMETER" ? effect.lifecycle.durationValue.parameterKey : null;
    if (durationKey) pass = pass && (localParameters.has(durationKey) || publicParameters.has(durationKey));
    if (effect.lifecycle?.expiryMode === "EXPLICIT_ONLY") pass = pass && effect.lifecycle.durationValue === null;
    effectStructureChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, resultType: result.resultType, valueRule, durationKey, pass });
    const attributeKey = result.detail?.attributeKey;
    if (["move_speed_percent", "bonus_attack_speed_percent", "life_steal_percent"].includes(attributeKey)) {
      const ratioPass = result.detail?.modifierZoneKey === "attribute_flat_add" && (value?.kind === "FORMULA" || value?.kind === "PARAMETER");
      ratioAttributeChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, attributeKey, modifierZoneKey: result.detail?.modifierZoneKey || null, pass: ratioPass });
    }
    for (const index of [0, 1]) {
      const scenario = scenarioFor(skillKey, index);
      try {
        const params = parameterMap(skillKey, scenario.rank, scenario.characterLevel, scenario.inputs);
        const base = value.kind === "FORMULA" ? evaluate(skillData.write.formulas.find(item => item.formulaKey === value.formulaKey).expression, params, attrsFor(scenario)) : need(params, value.parameterKey, `效果参数${value.parameterKey}`);
        const finalValue = base * valueRule.fixedMultiplier;
        const expectedValue = value.kind === "FORMULA" ? expected(skillKey, value.formulaKey, scenario) : base;
        effectValueChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, scene: index === 0 ? "基础场景" : "强化场景", base: round(base), sourceExpected: round(expectedValue), multiplier: valueRule.fixedMultiplier, finalValue: round(finalValue), pass: Number.isFinite(finalValue) && equal(finalValue, base) && (value.kind !== "FORMULA" || equal(base, expectedValue)) });
      } catch (error) {
        effectValueChecks.push({ skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, scene: index === 0 ? "基础场景" : "强化场景", pass: false, error: error.message });
      }
    }
  }
}
assert(effectStructureChecks.length === candidate.counts.newEffects && effectStructureChecks.every(item => item.pass), `效果结构核对失败：${JSON.stringify(effectStructureChecks.filter(item => !item.pass).slice(0, 4))}`);
assert(effectValueChecks.length === candidate.counts.newEffects * 2 && effectValueChecks.every(item => item.pass), `效果最终值核对失败：${JSON.stringify(effectValueChecks.filter(item => !item.pass).slice(0, 4))}`);
assert(ratioAttributeChecks.length > 0 && ratioAttributeChecks.every(item => item.pass), `比例属性乘区核对失败：${JSON.stringify(ratioAttributeChecks.filter(item => !item.pass))}`);


// 修订二专项独立核对：固定数组全等级、字典引用、保护组成、资格时长和状态场景。
const fixedSourceArrayChecks = sourceParameterSpecs.filter(spec => spec.mode === "FIXED" && (spec.sourceKind === "DataValue" || spec.sourceKind === "field")).map(spec => {
  const parameter = parameterOf(spec.skillKey, spec.parameterKey);
  const raw = spec.sourceKind === "DataValue" ? dataRow(spec.heroId, spec.slot, spec.name) : spell(spec.heroId, spec.slot)?.[spec.name];
  const values = Array.isArray(raw) ? raw : [raw];
  const transform = spec.transformName === "秒转整数毫秒" ? toMs : spec.transformName === "百分数点转比例" ? value => value / 100 : value => value;
  const transformed = values.map(value => norm(transform(value)));
  const pass = Boolean(parameter) && transformed.every(value => equal(value, parameter.fixedValue));
  return { skillKey: spec.skillKey, parameterKey: spec.parameterKey, sourceKind: spec.sourceKind, source: spec.heroId + "/" + spec.slot + "/" + spec.name, rawValues: values, transformed, candidate: parameter?.fixedValue ?? null, pass };
});
assert(fixedSourceArrayChecks.every(item => item.pass), "固定源数组并非全等级一致：" + JSON.stringify(fixedSourceArrayChecks.filter(item => !item.pass).slice(0, 4)));
const integerParameterChecks = [];
const integerValueChecks = [];
for (const skillKey of candidate.order) for (const parameter of candidate.skills[skillKey].write.parameters) {
  const values = parameter.valueMode === "FIXED" ? [parameter.fixedValue] : Object.values(parameter.levelValues || {});
  if (parameter.valueType === "INTEGER") {
    const valuePass = parameter.valueMode === "RUNTIME_INPUT" ? parameter.fixedValue === null && parameter.levelValues === null : values.every(value => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value));
    integerParameterChecks.push({ skillKey, parameterKey: parameter.parameterKey, valueMode: parameter.valueMode, valueCount: parameter.valueMode === "RUNTIME_INPUT" ? 0 : values.length, pass: valuePass });
    if (parameter.valueMode !== "RUNTIME_INPUT") values.forEach((value, index) => integerValueChecks.push({ skillKey, parameterKey: parameter.parameterKey, index, value, pass: typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) }));
  }
}
assert(integerParameterChecks.every(item => item.pass) && integerValueChecks.every(item => item.pass), "INTEGER参数或值检查失败");
const existingKeysByRoute = new Set();
for (const item of protection.requests || []) if (/^\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)\//.test(item.route)) existingKeysByRoute.add(item.route);
const newRoutes = [];
for (const skillKey of candidate.order) for (const kind of ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"]) {
  const routeKind = { internalStates: "internal-states", triggerRules: "trigger-rules" }[kind] || kind;
  const field = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" }[kind];
  for (const item of candidate.skills[skillKey].write[kind]) newRoutes.push("/skills/" + skillKey + "/" + routeKind + "/" + item[field]);
}
const overlapRoutes = newRoutes.filter(route => existingKeysByRoute.has(route));
const publicOverlapRoutes = newRoutes.filter(route => candidate.reusedPublicParameters.some(item => "/skills/" + item.skillKey + "/parameters/" + item.parameterKey === route));
assert(overlapRoutes.length === 0 && publicOverlapRoutes.length === 0, "新增组成与保护或公共复用重叠：" + JSON.stringify({ overlapRoutes, publicOverlapRoutes }));
const protectedCounts = { parameters: 79, formulas: 8, effects: 16, processes: 4, "internal-states": 0, "trigger-rules": 13 };
assert(JSON.stringify(existingTotals) === JSON.stringify(protectedCounts) && protectedCompositionRoutes.length === 120, "既有120项组成保护计数失败");

const dictionaryRefChecks = [];
const statusItems = protectedByRoute.get("/statuses")?.data?.items || [];
const statusKeys = new Set(statusItems.map(item => item.statusKey).filter(Boolean));
const dictionarySets = { damageTypeKey: damageTypeKeys, absorbedDamageTypeKey: damageTypeKeys, modifierZoneKey: modifierZoneKeys, statusKey: statusKeys };
const walkDictionaryRefs = (node, path = "") => {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const current = path ? path + "." + key : key;
    if (Object.prototype.hasOwnProperty.call(dictionarySets, key) && value !== null && value !== undefined) {
      const set = dictionarySets[key];
      dictionaryRefChecks.push({ field: key, path: current, value, dictionaryAvailable: set.size > 0, pass: set.has(value) });
    }
    if (value && typeof value === "object") walkDictionaryRefs(value, current);
  }
};
walkDictionaryRefs(candidate.skills);
assert(dictionaryRefChecks.every(item => item.pass), "字典引用无效：" + JSON.stringify(dictionaryRefChecks.filter(item => !item.pass).slice(0, 4)));
assert(dictionaryRefChecks.filter(item => item.field === "damageTypeKey").every(item => ["physics", "magic", "real"].includes(item.value)), "伤害类型存在未证别名");
const allAttributeRefs = [];
const walkAttributes = (node, path = "") => {
  if (!node || typeof node !== "object") return;
  if (node.nodeType === "ATTRIBUTE") allAttributeRefs.push({ path, owner: node.attributeOwner, attributeKey: node.attributeKey, valueKind: node.attributeValueKind, pass: attributeKeys.has(node.attributeKey) });
  for (const [key, value] of Object.entries(node)) if (value && typeof value === "object") walkAttributes(value, path ? path + "." + key : key);
};
walkAttributes(candidate.skills);
assert(allAttributeRefs.every(item => item.pass), "属性引用不存在：" + JSON.stringify(allAttributeRefs.filter(item => !item.pass)));

const wLifeStealEffects = ["normal_life_steal", "awakened_life_steal"].map(key => candidate.skills.udyr_w.write.effects.find(effect => effect.effectKey === key));
assert(wLifeStealEffects.every(effect => effect && effect.results?.[0]?.detail?.operation === "INCREASE"), "乌迪尔W吸血操作不是INCREASE");
assert(wLifeStealEffects.every(effect => effect.lifecycle?.durationValue?.kind === "PARAMETER" && effect.lifecycle.durationValue.parameterKey === "actual_remaining_two_attack_qualification_duration_ms"), "乌迪尔W吸血借用了错误寿命或缺少资格时长");
const wLifeStealSource = norm(dataAt("Udyr", "W", "LifeSteal", 1));
const wLifeStealMultiplier = norm(dataAt("Udyr", "W", "HealAttackMult", 1));
const udyrWLifeStealScenarios = [
  { scene: "普通W1+外部10%", mode: "normal", external: 0.1, contribution: wLifeStealSource, expected: 0.1 + wLifeStealSource },
  { scene: "觉醒W1+外部10%", mode: "awakened", external: 0.1, contribution: wLifeStealSource * wLifeStealMultiplier, expected: 0.1 + wLifeStealSource * wLifeStealMultiplier },
].map(scene => ({ ...scene, actual: scene.external + scene.contribution, pass: equal(scene.external + scene.contribution, scene.expected) && ((scene.mode === "normal" ? wLifeStealEffects[0] : wLifeStealEffects[1]).results[0].detail.operation === "INCREASE") }));
assert(udyrWLifeStealScenarios.every(item => item.pass) && equal(udyrWLifeStealScenarios[0].actual, 0.25) && equal(udyrWLifeStealScenarios[1].actual, 0.4), "乌迪尔W外部10%吸血场景失败");
const udyrWQualificationChecks = wLifeStealEffects.map(effect => {
  const key = effect.lifecycle.durationValue.parameterKey;
  let rejected = false; let error = null;
  try { need({}, key, "运行输入" + key); } catch (caught) { rejected = true; error = caught.message; }
  return { effectKey: effect.effectKey, parameterKey: key, rejected, error };
});
const qRangeEffect = candidate.skills.udyr_q.write.effects.find(effect => effect.effectKey === "attack_range");
assert(qRangeEffect?.lifecycle?.durationValue?.parameterKey === "actual_remaining_two_attack_range_qualification_duration_ms", "乌迪尔Q攻击距离未使用独立资格时长");
udyrWQualificationChecks.push({ effectKey: "udyr_q/attack_range", parameterKey: qRangeEffect.lifecycle.durationValue.parameterKey, rejected: (() => { try { need({}, qRangeEffect.lifecycle.durationValue.parameterKey, "Q攻击距离资格时长"); return false; } catch { return true; } })() });
assert(udyrWQualificationChecks.every(item => item.rejected), "两击资格时长缺值没有拒绝");
const fractionalWScene = { ...scenarioFor("udyr_w", 0), inputs: { ...scenarioFor("udyr_w", 0).inputs, awakened_shield_level_actual: 73.25 } };
const fractionalParams = parameterMap("udyr_w", fractionalWScene.rank, fractionalWScene.characterLevel, fractionalWScene.inputs);
const fractionalActual = evaluate(candidate.skills.udyr_w.write.formulas.find(item => item.formulaKey === "awakened_shield").expression, fractionalParams, attrsFor(fractionalWScene));
const fractionalExpected = expected("udyr_w", "awakened_shield", fractionalWScene);
const fractionalRuntimeScenarios = [{ skillKey: "udyr_w", parameterKey: "awakened_shield_level_actual", value: 73.25, actual: round(fractionalActual), expected: round(fractionalExpected), pass: equal(fractionalActual, fractionalExpected) }];
assert(fractionalRuntimeScenarios[0].pass && !Number.isInteger(fractionalRuntimeScenarios[0].value), "觉醒护盾小数运行场景失败");
const asheQAttackSpeedSource = dataRow("Ashe", "Q", "BonusAS").slice(1, 6).map(value => norm(value / 100));
const asheQAttackSpeedCandidate = parameterOf("ashe_q", "bonus_attack_speed_ratio");
const asheQAttackSpeedAssertions = { source: asheQAttackSpeedSource, candidate: asheQAttackSpeedCandidate.levelValues, keys: Object.keys(asheQAttackSpeedCandidate.levelValues || {}), pass: asheQAttackSpeedCandidate.valueMode === "SKILL_LEVEL" && JSON.stringify(Object.keys(asheQAttackSpeedCandidate.levelValues || {})) === JSON.stringify(["1", "2", "3", "4", "5"]) && asheQAttackSpeedSource.every((value, index) => equal(value, asheQAttackSpeedCandidate.levelValues[String(index + 1)])) };
assert(asheQAttackSpeedAssertions.pass, "艾希Q五级攻速数组失败");
assert(!candidate.skills.udyr_w.write.effects.some(effect => effect.effectKey === "awakened_total_heal") && !candidate.skills.udyr_r.write.effects.some(effect => effect.effectKey === "empowered_percent_hp_damage") && !candidate.skills.udyr_e.write.effects.some(effect => effect.effectKey === "empowered_attack_range"), "修订删除的总量或未消费效果仍存在");
assert(candidate.skills.udyr_w.write.formulas.some(formula => formula.formulaKey === "awakened_total_heal") && candidate.skills.udyr_r.write.formulas.some(formula => formula.formulaKey === "empowered_percent_hp_damage"), "总量公式被错误删除");
assert(parameterOf("udyr_w", "awakened_shield_level_actual").valueType === "DECIMAL", "觉醒护盾实际值未改DECIMAL");
assert(!parameterOf("udyr_e", "empowered_attack_range_bonus") && !parameterOf("ashe_q", "timer_duration_ms") && !parameterOf("ashe_q", "stack_falloff_duration_ms"), "未消费参数未清理");

const actualCounts = {
  newParameters: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.parameters.length, 0),
  newFormulas: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.formulas.length, 0),
  newEffects: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.effects.length, 0),
  newProcesses: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.processes.length, 0),
  newInternalStates: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.internalStates.length, 0),
  newTriggerRules: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.triggerRules.length, 0),
};
actualCounts.newTotal = Object.values(actualCounts).reduce((sum, value) => sum + value, 0);
assert(JSON.stringify(actualCounts) === JSON.stringify({ newParameters: 120, newFormulas: 24, newEffects: 26, newProcesses: 0, newInternalStates: 0, newTriggerRules: 0, newTotal: 170 }), `候选计数不符：${JSON.stringify(actualCounts)}`);
assert(JSON.stringify({ newParameters: candidate.counts.newParameters, newFormulas: candidate.counts.newFormulas, newEffects: candidate.counts.newEffects, newProcesses: candidate.counts.newProcesses, newInternalStates: candidate.counts.newInternalStates, newTriggerRules: candidate.counts.newTriggerRules, newTotal: candidate.counts.newTotal }) === JSON.stringify(actualCounts), "候选计数字段与正文不一致");
assert(plan.requestCount === 170 && plan.requests.length === 170, "POST计划数量不符");
const candidateFileSha256 = shaFile(CANDIDATE_FILE);
const planFileSha256 = shaFile(PLAN_FILE);
const scopeFileSha256 = shaFile(SCOPE_FILE);
const sourceValuesFileSha256 = shaFile(SOURCE_VALUES_FILE);
assert(plan.candidateSha256 === candidateFileSha256, "计划中的候选散列与文件不符");
assert(plan.sourceRangeSha256 === scopeFileSha256, "计划中的范围散列与文件不符");
assert(candidate.meta.candidateSha256 === null, "候选自描述散列应保持非自引用空值");

const mathGeneratedAt = new Date().toISOString();
const mathReport = {
  revisionTwoChecks: {
    asheQEmpoweredAttackSpellShieldBlockScope: asheQRevisionDamage.spellShieldBlockScope,
    withheldEffects: withheld.effects.map(item => ({ skillKey: item.skillKey, effectKey: item.effectKey, resultKey: item.resultKey, normalSaveSet: item.normalSaveSet, proven: item.proven, suggestedScope: item.suggestedScope, originalSpellShieldBlockScope: item.originalSpellShieldBlockScope })),
    withheldCount: withheld.effects.length,
    remainingEffectCount: candidate.counts.newEffects,
    sourceSelectedEffectConsistency,
    planEffectConsistency,
    publicReuseProtectedChecks,
    parameterFormulaPreservation,
    conceptualAllComponents: candidate.counts.conceptualAllComponents,
    revisionDiffSchema: revisionDiff.schema,
  },
  generatedAt: mathGeneratedAt,
  batch: "第五十批乌迪尔阿兹尔艾希伊泽瑞尔",
  revision: candidate.revision,
  status: "PASS",
  sourcePolicy: "固定客户端16.17、官方16.17.1；期望侧每公式直接读取冻结原始DataValues、字段和计算树，不使用候选公式反推。",
  candidateSha256: candidateFileSha256,
  planSha256: planFileSha256,
  scopeSha256: scopeFileSha256,
  sourceValuesSha256: sourceValuesFileSha256,
  inputGETs: inputVersion.GETs,
  reusedPublicParameters: reuseList.length,
  protectedCurrentCompositionLists: protectedCompositionRoutes.length,
  protectedExistingTotals: existingTotals,
  cursor: { verdict: "READY", runId: cursorAudit.runId, events: cursorAudit.events, uniqueTools: cursorAudit.uniqueTools, inputsChecked: cursorAudit.inputsChecked, apiWrites: cursorAudit.apiWrites, gitDelta: Array.isArray(cursorAudit.gitDelta) ? cursorAudit.gitDelta.length : Number(cursorAudit.gitDelta || 0) },
  counts: { ...actualCounts, reusedPublicParameters: reuseList.length, plannedTotalIncludingReused: actualCounts.newTotal + protectedCompositionRoutes.length },
  parameterChecks: { total: parameterChecks.length, pass: parameterChecks.filter(item => item.pass).length, sourceMappings: sourceParameterChecks.length, sourceMappingsPass: sourceParameterChecks.filter(item => item.pass).length, integerChecks: integerChecks.length, integerPass: integerChecks.filter(item => item.pass).length, integerParameterCount: integerParameterChecks.length, integerParameterPass: integerParameterChecks.filter(item => item.pass).length, integerValueCount: integerValueChecks.length, integerValuePass: integerValueChecks.filter(item => item.pass).length, millisecondsChecked: integerChecks.filter(item => item.msOk).length },
  levelChecks: candidate.order.map(skillKey => ({ skillKey, maxLevel: candidate.skills[skillKey].maxLevel, skillLevelParameters: candidate.skills[skillKey].write.parameters.filter(item => item.valueMode === "SKILL_LEVEL").map(item => ({ parameterKey: item.parameterKey, keys: Object.keys(item.levelValues || {}) })) })),
  formulaChecks: { definitions: formulaTreeChecks, structures: formulaStructureChecks, scenarios: formulaResults, scenarioCount: formulaResults.length, formulaCount: candidate.counts.newFormulas, allTwoScenes: formulaResults.length === candidate.counts.newFormulas * 2, missingReferenceCases: formulaMissingCases, runtimeMissingCases, allMissingRejected: formulaMissingCases.every(item => item.rejected) && runtimeMissingCases.every(item => item.rejected) },
  effectChecks: { enumChecks, dictionaryRefChecks, attributeRefs: allAttributeRefs, structures: effectStructureChecks, finalValues: effectValueChecks, finalValueCount: effectValueChecks.length, allMultiplierOne: effectStructureChecks.every(item => item.valueRule.fixedMultiplier === 1), ratioAttributes: ratioAttributeChecks },
  sourceFormulaChecks: formulaTreeChecks, fixedSourceArrayChecks, asheQAttackSpeedAssertions, udyrWLifeStealScenarios, udyrWQualificationChecks, fractionalRuntimeScenarios, protectedCounts, overlapRoutes, publicOverlapRoutes, integerValueChecks,
  sourceParameterChecks,
  noBusinessApiCalls: true,
  apiCalls: 0,
  apiWrites: 0,
  gitWrites: 0,
  planOnly: true,
  notes: ["目标最大生命乘法按正文目标语义在数学展开式中记录，不假称原始树自带TARGET.hp。", "艾希被动前导1与一次总攻击力展开只保留公式，不另建普攻附伤效果。", "未知角色等级曲线、触发次数、状态键和寿命不补默认；运行输入缺值严格拒绝。", "阿兹尔R NumberOfSoldiers只作墙构成数量，不乘一次冲锋伤害；阿兹尔P/Q/W完整士兵链与艾希E纯视野保持排除。", "修订二核对所有非空伤害类型、吸收类型、乘区和状态字典引用；固定源数组按全数组检查，整数参数和整数值分开计数。"],
};
const mathReportBytes = jsonBytes(mathReport);
const mathReportSha256 = sha256(mathReportBytes);
const experience = "# 第五十批候选体验报告（修订二）\n\n本修订从修订一冻结候选离线生成，固定客户端16.17、官方资料16.17.1，覆盖乌迪尔、阿兹尔、艾希、伊泽瑞尔20个技能槽。正常新增120个参数、24个公式、26个效果，共170项；既有组成保护为79个参数、8个公式、16个效果、4个过程、13个触发，共120项。26项公共参数是这120项既有保护组成的子集，不重复计入新增；含既有保护的概念总组成是120+170=290。\n\n艾希Q强化攻击结果的spellShieldBlockScope由修订一的RESULT改为null，沿用固定本地与公开资料的交叉证据。其五级BonusAS仍按原始数组保存为0.2、0.3、0.4、0.5、0.6，数学报告继续核对完整等级和一次强化攻击公式。\n\n乌迪尔Q的standard_on_hit、standard_max_health_hit、empowered_max_health_hit，以及R的pulse_damage，组件与公式均保留，但从正常效果集合和请求计划撤出。四项的原始效果完整快照、未证结果范围、来源指针和训练营取证步骤保存在待补护盾证据.json；不把未知范围猜成null，也不新增触发或运行节点。Q附加段仍按Q姿态普攻分支记录，R脉冲仍与风暴周期伤害分开，具体拦截粒度待逐结果补证。\n\n本修订未改动120个参数和24个公式；独立数学期望侧直接读取冻结原始DataValues、字段和计算树，24个公式各核对基础与强化两个场景，共48场景。剩余26个效果各核对两个最终值场景，共52项；同时检查缺值拒绝、源数组、整数毫秒、二元节点、非空字典引用、全部属性引用、最终倍率和比例属性固定加算区。\n\n这些文件是静态录入意图与离线核算证据，不代表业务数据库、运行时、页面或战斗已经保存或完成。本次业务API调用、数据库写入、浏览器操作和Git写入均为0。";

const version = { ...readJson(VERSION_FILE), generatedAt: mathGeneratedAt, status: "候选与独立数学核算均通过；未调用业务接口", candidateSha256: candidateFileSha256, planSha256: planFileSha256, scopeSha256: scopeFileSha256, sourceValuesSha256: sourceValuesFileSha256, mathReportSha256, sourceMath: "独立数学核算.mjs", sourceMathStatus: "PASS", counts: clone(candidate.counts), requestCount: plan.requestCount, apiCalls: 0, apiWrites: 0, businessWrites: 0, noBusinessWrites: true };
const freezeNotice = { ...readJson(FREEZE_FILE), generatedAt: mathGeneratedAt, status: "候选与独立数学核算均通过，等待主负责人保存；未调用业务接口", candidateSha256: candidateFileSha256, planSha256: planFileSha256, scopeSha256: scopeFileSha256, sourceValuesSha256: sourceValuesFileSha256, mathReportSha256, counts: clone(candidate.counts), requestCount: plan.requestCount, apiCalls: 0, apiWrites: 0, businessWrites: 0 };
const readme = "# 第五十批候选（修订二）\n\n本目录保存乌迪尔、阿兹尔、艾希、伊泽瑞尔20个技能槽的修订二候选、写前请求计划、来源值证据、待补护盾证据、修订差异、独立数学报告和耐久副本。来源固定客户端16.17、官方16.17.1；来源评审为READY。\n\n修订二正常新增120个参数、24个公式、26个效果，共170项；既有组成保护为79个参数、8个公式、16个效果、4个过程、13个触发，共120项。26项公共参数属于既有120项保护组成的子集，含保护组成的概念总数为290；170项是本次请求计划的全部新增请求。\n\n艾希Q强化攻击结果的spellShieldBlockScope改为null；艾希Q五级攻速数组仍为0.2/0.3/0.4/0.5/0.6。乌迪尔Q三项普攻附加结果和R攻击脉冲从正常效果集合撤出，四项原始效果、原因和训练营步骤单独保存在待补护盾证据.json；参数与公式保持完整，未知范围不猜null。\n\n全部24个公式各核对两个源值场景，共48场景；剩余26个效果各核对两个最终值场景，共52项。离线核算读取冻结原始树而不是候选数值作为期望，并检查完整等级数组、原生有限数字、整数与毫秒、参数/公式类型引用、二元运算、最终倍率、比例属性固定加算区和非空字典键。\n\n这些文件只表达静态录入意图和离线证据，业务API、数据库、浏览器和Git均未调用或写入。";
const outputBytes = { "候选版本.json": jsonBytes(version), "来源冻结通知.json": jsonBytes(freezeNotice), "独立数学报告.json": mathReportBytes, "体验报告.md": Buffer.from(experience, "utf8"), "README.md": Buffer.from(readme, "utf8") };
for (const [name, bytes] of Object.entries(outputBytes)) { writeBytes(path.join(ROOT, name), bytes); writeBytes(path.join(DURABLE, name), bytes); }
writeBytes(path.join(DURABLE, "独立数学核算.mjs"), fs.readFileSync(MATH_FILE));
const allOutputFiles = ["完整候选.json", "请求计划.json", "来源与范围.json", "来源值摘要.json", "待补护盾证据.json", "修订差异.json", "候选版本.json", "来源冻结通知.json", "生成修订二.mjs", "独立数学核算.mjs", "独立数学报告.json", "体验报告.md", "README.md", "收尾散列.mjs"];
const outputFileHashes = Object.fromEntries(allOutputFiles.map(name => { const file = path.join(ROOT, name); return [name, { sha256: shaFile(file), byteSize: fs.statSync(file).size }]; }));
const sourceHashes = { sourceBindingSha256: shaFile(path.join(INPUT, "来源绑定与当前文本.json")), sourceRangeSha256: shaFile(path.join(INPUT, "主负责人最终范围与核对说明.md")), sourceAuditSha256: shaFile(path.join(INPUT, "主负责人前两英雄源值核对.md")), protectionSnapshotSha256: shaFile(path.join(INPUT, "参考资料", "当前20槽保护快照.json")), publicReuseSha256: shaFile(path.join(INPUT, "参考资料", "公共参数复用清单.json")), inputVersionSha256: shaFile(path.join(INPUT, "输入版本.json")), cursorConclusionSha256: shaFile(path.join(REVIEW, "Cursor来源复核结论.md")), cursorAuditSha256: shaFile(path.join(REVIEW, "主负责人执行审计.json")), cursorSummarySha256: shaFile(path.join(REVIEW, "summary.json")), mathReportSha256 };
const hashesSummary = { generatedAt: mathGeneratedAt, batch: mathReport.batch, revision: candidate.revision, status: "候选、计划和独立数学核算文件散列；未调用业务接口", candidateSha256: candidateFileSha256, planSha256: planFileSha256, scopeSha256: scopeFileSha256, sourceValuesSha256: sourceValuesFileSha256, mathReportSha256, counts: clone(candidate.counts), requestCount: plan.requestCount, outputFiles: outputFileHashes, sourceHashes, cursor: mathReport.cursor, noApiCalls: true, apiWrites: 0 };
const hashesBytes = jsonBytes(hashesSummary);
writeBytes(HASHES_FILE, hashesBytes); writeBytes(path.join(DURABLE, "来源哈希汇总.json"), hashesBytes);
const manifest = { generatedAt: mathGeneratedAt, batch: mathReport.batch, revision: candidate.revision, files: { ...outputFileHashes, "来源哈希汇总.json": { sha256: shaFile(HASHES_FILE), byteSize: fs.statSync(HASHES_FILE).size } }, sourceHashes, candidateSha256: candidateFileSha256, planSha256: planFileSha256, scopeSha256: scopeFileSha256, sourceValuesSha256: sourceValuesFileSha256, mathReportSha256, counts: clone(candidate.counts), requestCount: plan.requestCount, cursor: mathReport.cursor, noApiCalls: true, apiWrites: 0 };
writeJson(MANIFEST_FILE, manifest); writeJson(path.join(DURABLE, "文件散列.json"), manifest);
console.log(JSON.stringify({ status: "PASS", candidateSha256: candidateFileSha256, planSha256: planFileSha256, scopeSha256: scopeFileSha256, sourceValuesSha256: sourceValuesFileSha256, mathReportSha256, counts: mathReport.counts, formulaScenarios: formulaResults.length, formulaMissingCases: formulaMissingCases.length, runtimeMissingCases: runtimeMissingCases.length, effectFinalValueChecks: effectValueChecks.length, inputGETs: inputVersion.GETs, reusedPublicParameters: reuseList.length, apiCalls: 0, apiWrites: 0, gitWrites: 0, root: ROOT, durable: DURABLE }, null, 2));
