import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(ROOT, "..");
const REVISION = "hero50-source-v2-luna-revision-1";
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const writeJson = (file, value) => fs.writeFileSync(file, jsonBytes(value));
const candidateFile = path.join(ROOT, "完整候选.json");
const planFile = path.join(ROOT, "请求计划.json");
const sourceValuesFile = path.join(ROOT, "来源值摘要.json");
const scopeFile = path.join(ROOT, "来源与范围.json");

const candidate = readJson(path.join(BASE, "完整候选.json"));
const sourceValues = readJson(path.join(BASE, "来源值摘要.json"));
const scope = readJson(path.join(BASE, "来源与范围.json"));
const basePlan = readJson(path.join(BASE, "请求计划.json"));

candidate.meta.scope = "乌迪尔、阿兹尔、艾希、伊泽瑞尔20个技能槽；保留乌迪尔姿态本体、阿兹尔E/R本体载荷、艾希P/Q缺失组成；阿兹尔P/Q/W完整士兵链和艾希E纯视野属于本轮范围外；艾希W/R与伊泽瑞尔五槽为既有组成保护并复用，本轮不重复新增。";
scope.globalScope.excluded = (scope.globalScope.excluded || []).map(text => text === "已有Ashe W/R与Ez五槽组成重复写入" ? "艾希W/R与伊泽瑞尔五个技能槽的既有组成保护并复用，本轮不重复新增" : text);

const keyField = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" };
const listKeys = (skill, kind) => (skill.write[kind] || []).map(item => item[keyField[kind]]);
const syncSelected = skill => {
  skill.source.selectedParameterKeys = listKeys(skill, "parameters");
  skill.source.selectedFormulaKeys = listKeys(skill, "formulas");
  skill.source.selectedEffectKeys = listKeys(skill, "effects");
  skill.source.pending = clone(skill.pending || []);
  skill.source.excluded = clone(skill.excluded || []);
};
const syncRecordable = (record, skill) => {
  record.recordableParameters = listKeys(skill, "parameters");
  record.recordableFormulas = listKeys(skill, "formulas");
  record.recordableEffects = listKeys(skill, "effects");
  record.pending = clone(skill.pending || []);
  record.excluded = clone(skill.excluded || []);
};
const find = (skillKey, kind, key) => {
  const item = candidate.skills[skillKey].write[kind].find(row => row[keyField[kind]] === key);
  if (!item) throw new Error(`找不到${skillKey}/${kind}/${key}`);
  return item;
};
const remove = (skillKey, kind, key) => {
  const rows = candidate.skills[skillKey].write[kind];
  const index = rows.findIndex(row => row[keyField[kind]] === key);
  if (index < 0) throw new Error(`找不到待删除项：${skillKey}/${kind}/${key}`);
  rows.splice(index, 1);
};
const add = (skillKey, kind, item) => candidate.skills[skillKey].write[kind].push(item);

// 艾希Q：BonusAS源数组技能等级1至5为20/30/40/50/60百分数点。
Object.assign(find("ashe_q", "parameters", "bonus_attack_speed_ratio"), {
  valueMode: "SKILL_LEVEL", fixedValue: null,
  levelValues: { "1": 0.2, "2": 0.3, "3": 0.4, "4": 0.5, "5": 0.6 },
  description: "BonusAS源数组技能等级1至5为20/30/40/50/60百分数点，转换为0.20/0.30/0.40/0.50/0.60；数学逐级读取原始数组。",
});
remove("ashe_q", "parameters", "timer_duration_ms");
remove("ashe_q", "parameters", "stack_falloff_duration_ms");
candidate.skills.ashe_q.pending = ["攻击叠层事件、4层激活资格、消耗层数、强化状态替代普通攻击、每次一次攻击特效和层数衰减时序待接线；攻速五级数组已逐级录入。"];
candidate.skills.ashe_q.excluded = ["层数自动衰减过程、TimerDuration/StackFalloffDuration源字段未被当前消费者使用，保留在来源边界而不建过程；额外小型打击效果、额外普攻和其他目标分配排除。"];

// 乌迪尔W：本技能吸血贡献可增加外部值，普通与觉醒由事件层互斥替代。
const wQualification = {
  parameterKey: "actual_remaining_two_attack_qualification_duration_ms",
  name: "实际剩余两次攻击资格时长（毫秒）", valueType: "INTEGER", valueMode: "RUNTIME_INPUT",
  fixedValue: null, levelValues: null,
  description: "本次W普通或觉醒下两次攻击资格在当前时刻的实际剩余时长；无默认值，不等同于4秒护盾寿命，攻击消耗和姿态离开由事件层处理。",
  sortOrder: 200,
};
add("udyr_w", "parameters", wQualification);
const normalWLifeSteal = find("udyr_w", "effects", "normal_life_steal");
const awakenedWLifeSteal = find("udyr_w", "effects", "awakened_life_steal");
normalWLifeSteal.description = "普通姿态下两次攻击的生命偷取比例；本技能贡献使用INCREASE并与觉醒贡献互斥替代，外部装备生命偷取保留，资格时长待事件层提供。";
awakenedWLifeSteal.description = "觉醒姿态下两次攻击的生命偷取比例；本技能贡献使用INCREASE并与普通贡献互斥替代，外部装备生命偷取保留，资格时长待事件层提供。";
for (const effect of [normalWLifeSteal, awakenedWLifeSteal]) {
  effect.lifecycle.durationValue = { kind: "PARAMETER", parameterKey: wQualification.parameterKey };
  effect.lifecycle.reapplicationDurationMode = "REFRESH_ALL";
  effect.results[0].detail.operation = "INCREASE";
  effect.results[0].description = effect.effectKey === "normal_life_steal"
    ? "只记录本技能生命偷取贡献；与觉醒贡献互斥，外部来源不被覆盖，实际两次攻击资格由事件层提供。"
    : "只记录本技能觉醒生命偷取贡献；与普通贡献互斥，外部来源不被覆盖，实际两次攻击资格由事件层提供。";
}
remove("udyr_w", "effects", "awakened_total_heal");
const awakenedShieldActual = find("udyr_w", "parameters", "awakened_shield_level_actual");
awakenedShieldActual.valueType = "DECIMAL";
awakenedShieldActual.description = "由运行层提供RecastShield在当前角色等级的20至150实际值；中间曲线未知且无默认，允许小数实际输入。";
candidate.skills.udyr_w.pending = ["觉醒护盾角色等级中间曲线、普通/觉醒应用顺序、下两次攻击事件、实际剩余两次攻击资格时长、4秒治疗的周期分配和吸血结算时点待接线；总治疗只保留公式与来源时长，不挂一次性直接治疗。"];

// 乌迪尔Q：攻击距离不是4秒攻速寿命，使用自己的无默认两击资格时长。
const qQualification = {
  parameterKey: "actual_remaining_two_attack_range_qualification_duration_ms",
  name: "实际剩余两次攻击攻击距离资格时长（毫秒）", valueType: "INTEGER", valueMode: "RUNTIME_INPUT",
  fixedValue: null, levelValues: null,
  description: "本次Q姿态下额外50攻击距离所对应的实际剩余两次攻击资格时长；无默认值，不借用4秒攻速寿命，攻击消耗和姿态离开由事件层处理。",
  sortOrder: 280,
};
add("udyr_q", "parameters", qQualification);
const qRange = find("udyr_q", "effects", "attack_range");
qRange.description = "姿态中下两次攻击增加50攻击距离；使用独立的实际剩余两次攻击资格时长，不表示施法距离或4秒攻速寿命。";
qRange.lifecycle.durationValue = { kind: "PARAMETER", parameterKey: qQualification.parameterKey };
qRange.lifecycle.reapplicationDurationMode = "REFRESH_ALL";
candidate.skills.udyr_q.pending = ["普通/觉醒替代关系、下两次攻击如何触发闪电六击、两击资格及攻击距离/攻击速度消费、角色等级未知曲线、普攻事件和目标最大生命读取时点待接线；不将已知端点插值成默认18级曲线。"];

// 乌迪尔E/R：未消费值仅保留源证据；R觉醒百分比总量不挂一次性效果。
remove("udyr_e", "parameters", "empowered_attack_range_bonus");
remove("udyr_e", "effects", "empowered_attack_range");
candidate.skills.udyr_e.excluded = ["碰撞体积忽略与攻击无法取消的事件细节不展开；EmpoweredBonusRange=75未被当前正文或选中计算树消费，仅保留来源证据，不建参数或效果。"];
remove("udyr_r", "effects", "empowered_percent_hp_damage");
find("udyr_r", "parameters", "storm_ap_ratio").description = "仅对应觉醒PercentHPBlast的最大生命百分比法强项0.00035；普通StormDamage每秒法强项由storm_damage_ap_ratio=0.35独立读取。";
find("udyr_r", "formulas", "empowered_percent_hp_damage").description = "PercentHPBlast持续期总量公式为（角色等级实际比例+觉醒最大生命百分比法强项0.00035×法强）×目标最大生命；保留总量数学，不挂一次性效果或均分节拍。";
candidate.skills.udyr_r.pending = ["风暴区域命中、每秒重复次数、同一目标追踪、脉冲两次攻击、减速状态与觉醒额外减速事件待接线；觉醒百分比总量的实际节拍未知，普通每秒0.35法强项与觉醒0.00035最大生命百分比项分开；未知角色等级曲线无默认。"];

// 艾希P：属性节点的源枚举映射只是静态结构推断。
for (const key of ["damage_bonus_multiplier", "modified_attack_damage"]) {
  const formula = find("ashe_p", "formulas", key);
  formula.description = formula.description.replace("mStat9/mStatFormula2的属性枚举仍由运行输入提供", "mStat9/mStatFormula2到现有暴击伤害属性键的映射是静态结构推断，待运行层验证");
}

// 整槽排除项不保留空待办；受保护技能继续表述为保护复用。
for (const key of ["azir_p", "azir_q", "azir_w", "ashe_e"]) candidate.skills[key].pending = [];
candidate.skills.azir_p.excluded = ["太阳圆盘生命、攻击、抗性、瓦解、独立冷却与自主单位整链排除；本轮无待接新增组成。"];
candidate.skills.azir_q.excluded = ["黄沙士兵位移、士兵攻击、减速、额外目标与持续士兵链整槽排除；本轮无待接新增组成。"];
candidate.skills.azir_w.excluded = ["黄沙士兵自主存在、10秒寿命、两充能、多次戳刺和攻击特效整链排除；本轮无待接新增组成。"];
candidate.skills.ashe_e.excluded = ["纯地图视野与侦查、鹰单位、5秒视野、两充能和充能时间整槽排除；本轮无待接新增组成。"];
for (const key of ["ashe_w", "ashe_r", "ez_p", "ez_q", "ez_w", "ez_e", "ez_r"]) {
  candidate.skills[key].pending = ["已有组成继续受保护；本轮不新增重复参数、公式、效果、过程或触发，跨技能资格和运行边界留待统一迭代。"];
  candidate.skills[key].excluded = candidate.skills[key].excluded.filter(text => !/本轮只保护已有/.test(text));
}

for (const skill of Object.values(candidate.skills)) syncSelected(skill);
candidate.revision = REVISION;
candidate.meta.revision = REVISION;
candidate.meta.status = "修订一候选已生成，来源与结构已冻结；未调用业务接口";
candidate.meta.candidateSha256 = null;
candidate.meta.apiCalls = 0; candidate.meta.apiWrites = 0; candidate.meta.businessWrites = 0; candidate.meta.noBusinessWrites = true;
candidate.meta.revisionNotes = [
  "Ashe Q BonusAS按五级原始数组录入；Udyr W普通/觉醒吸血改INCREASE并使用独立无默认两击资格时长。",
  "Udyr Q攻击距离改用独立无默认两击资格时长；Udyr W总治疗和Udyr R觉醒百分比总量仅保留公式与源时长，不挂一次性效果。",
  "Udyr W角色等级护盾实际输入为DECIMAL；Udyr E75攻击距离、Ashe Q两个未消费计时字段仅留源边界；排除项待办已清理。",
];
const counts = {
  newParameters: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.parameters.length, 0),
  newFormulas: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.formulas.length, 0),
  newEffects: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.effects.length, 0),
  newProcesses: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.processes.length, 0),
  newInternalStates: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.internalStates.length, 0),
  newTriggerRules: candidate.order.reduce((sum, key) => sum + candidate.skills[key].write.triggerRules.length, 0),
};
counts.newTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
candidate.counts = { ...candidate.counts, ...counts, plannedTotalIncludingReused: counts.newTotal + candidate.reusedPublicParameters.length };
candidate.apiWrites = 0;
writeJson(candidateFile, candidate);

for (const [key, record] of Object.entries(sourceValues.sourceValues || {})) {
  const skill = candidate.skills[key]; if (!skill) continue;
  record.selectedParameterKeys = listKeys(skill, "parameters");
  record.selectedFormulaKeys = listKeys(skill, "formulas");
  record.selectedEffectKeys = listKeys(skill, "effects");
  record.pending = clone(skill.pending || []); record.excluded = clone(skill.excluded || []);
}
sourceValues.revision = REVISION; sourceValues.status = "修订一独立源值清单；未调用业务接口";
sourceValues.revisionNotes = candidate.meta.revisionNotes; sourceValues.noApiCalls = true; sourceValues.apiWrites = 0;
writeJson(sourceValuesFile, sourceValues);

for (const [key, record] of Object.entries(scope.skills || {})) {
  const skill = candidate.skills[key]; if (skill) syncRecordable(record, skill);
}
scope.revision = REVISION; scope.status = "修订一来源值与录入范围清单；未调用业务接口";
scope.revisionNotes = candidate.meta.revisionNotes; scope.noApiCalls = true; scope.apiWrites = 0;
writeJson(scopeFile, scope);

const requests = [];
let sequence = 1;
for (const skillKey of candidate.order) {
  const skill = candidate.skills[skillKey];
  for (const kind of ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"]) {
    const routeKind = { internalStates: "internal-states", triggerRules: "trigger-rules" }[kind] || kind;
    for (const body of skill.write[kind]) {
      const stableKey = body[keyField[kind]]; const route = `/skills/${skillKey}/${routeKind}`;
      requests.push({ sequence: sequence++, operation: "POST", method: "POST", route, detailRoute: `${route}/${stableKey}`, skillKey, kind: routeKind, stableKey, status: "仅意图，未调用", body: clone(body) });
    }
  }
}
const plan = clone(basePlan);
plan.generatedAt = new Date().toISOString(); plan.status = "修订一仅写入意图，未调用业务接口";
plan.batch = candidate.meta.batch; plan.revision = REVISION; plan.candidateSha256 = shaFile(candidateFile);
plan.sourceRangeSha256 = shaFile(scopeFile); plan.requestCount = requests.length; plan.counts = clone(candidate.counts);
plan.requests = requests; plan.noApiCalls = true; plan.apiWrites = 0; plan.businessWrites = 0;
writeJson(planFile, plan);
console.log(JSON.stringify({ revision: REVISION, counts: candidate.counts, requestCount: requests.length, candidateSha256: shaFile(candidateFile), planSha256: shaFile(planFile), scopeSha256: shaFile(scopeFile), sourceValuesSha256: shaFile(sourceValuesFile), apiCalls: 0, apiWrites: 0 }, null, 2));
