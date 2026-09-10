import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(ROOT, "..");
const REVISION = "hero49-source-v1-luna-candidate-revision-1";
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
const clone = value => JSON.parse(JSON.stringify(value));

const initialCandidate = readJson(path.join(BASE, "完整候选.json"));
const initialPlan = readJson(path.join(BASE, "请求计划.json"));
const candidate = clone(initialCandidate);
candidate.revision = REVISION;
candidate.meta.revision = REVISION;
candidate.meta.status = "修订一候选已生成，独立数学待执行；未调用业务接口";
candidate.meta.apiCalls = 0;
candidate.meta.businessWrites = 0;
candidate.meta.browserCalls = 0;
candidate.meta.gitWrites = 0;
candidate.sourceNotes = [
  ...candidate.sourceNotes.filter(note => !String(note).startsWith("修订一：")),
  "修订一：Gnar W/R移速档按源值0.2/0.4/0.6/0.8重核；Kled R百分比公式去除重复百分数单位；Quinn飞弹字段改为mSpell.missileSpeed；Quinn P纯显形和RekSai W保护冷却不生成候选；Quinn R单列非小兵受伤移除加速3秒。",
];

const param = (skillKey, parameterKey) => {
  const item = candidate.skills[skillKey]?.write?.parameters?.find(entry => entry.parameterKey === parameterKey);
  if (!item) throw new Error(`缺少参数 ${skillKey}/${parameterKey}`);
  return item;
};
const removeParam = (skillKey, parameterKey) => {
  const list = candidate.skills[skillKey].write.parameters;
  const index = list.findIndex(entry => entry.parameterKey === parameterKey);
  if (index < 0) throw new Error(`应删除参数不存在 ${skillKey}/${parameterKey}`);
  list.splice(index, 1);
};
const findFormula = (skillKey, formulaKey) => {
  const item = candidate.skills[skillKey]?.write?.formulas?.find(entry => entry.formulaKey === formulaKey);
  if (!item) throw new Error(`缺少公式 ${skillKey}/${formulaKey}`);
  return item;
};
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const SA = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "SOURCE_ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const SD = dataName => ({ nodeType: "SOURCE_DATA", dataName, transform: 1 });
const SC = (value, sourceLabel) => ({ nodeType: "SOURCE_CONSTANT", value, sourceLabel });
const ADD = (left, right) => ({ nodeType: "OPERATION", operation: "ADD", operands: [left, right] });
const MUL = (left, right) => ({ nodeType: "OPERATION", operation: "MULTIPLY", operands: [left, right] });

// 纳尔 W/R：源值为未学习 R 20%，R1/2/3 为 40%/60%/80%。
Object.assign(param("gnar_w", "r_unlearned_move_speed_ratio"), {
  fixedValue: 0.2,
  description: "GnarR.RHyperMovementSpeedPercent索引1为20%，W正文未学习R档位；比例属性。",
});
Object.assign(param("gnar_w", "r_level_1_move_speed_ratio"), {
  fixedValue: 0.4,
  description: "GnarR.RHyperMovementSpeedPercent索引2为40%，仅作W跨槽资格档位。",
});
Object.assign(param("gnar_w", "r_level_2_move_speed_ratio"), {
  fixedValue: 0.6,
  description: "GnarR.RHyperMovementSpeedPercent索引3为60%，仅作W跨槽资格档位。",
});
Object.assign(param("gnar_w", "r_level_3_move_speed_ratio"), {
  fixedValue: 0.8,
  description: "GnarR.RHyperMovementSpeedPercent索引4为80%，仅作W跨槽资格档位。",
});
Object.assign(param("gnar_r", "unlearned_move_speed_ratio"), {
  fixedValue: 0.2,
  description: "GnarR.RHyperMovementSpeedPercent索引1为20%，作为未学习R时W资格参考。",
});

// 克烈 R：源 mMultiplier 已是 0.01/0.03，括号中的 4/6/8 是百分数点读数；不再重复乘 0.01。
removeParam("kled_r", "percent_point_unit");
const kledRBracketCandidate = ADD(P("damage_percent_points"), MUL(P("bonus_ad_percent_points"), SA("SOURCE", "attack_damage", "BONUS")));
const kledRBracketSource = ADD(SD("PercentHPBase"), MUL(SC(0.029999999, "{598e3ed3}.mCoefficient"), SA("SOURCE", "attack_damage", "BONUS")));
const kledRTarget = MUL(kledRBracketCandidate, SA("TARGET", "hp", "TOTAL"));
const kledRSourceTarget = MUL(kledRBracketSource, SA("TARGET", "hp", "TOTAL"));
findFormula("kled_r", "minimum_magic_damage").expression = MUL(P("minimum_charge_multiplier"), kledRTarget);
findFormula("kled_r", "maximum_magic_damage").expression = MUL(P("maximum_charge_multiplier"), kledRTarget);
findFormula("kled_r", "minimum_magic_damage").description = "最小=0.01×(4/6/8+0.03×额外攻击力)×目标最大生命；括号按源百分数点读数。";
findFormula("kled_r", "maximum_magic_damage").description = "最大=0.03×(4/6/8+0.03×额外攻击力)×目标最大生命；括号按源百分数点读数。";
candidate.skills.kled_r.formulaEvidence.minimum_magic_damage.sourceRule = MUL(
  SC(0.01, "MinimumDamageTooltip.mMultiplier"),
  kledRSourceTarget,
);
candidate.skills.kled_r.formulaEvidence.maximum_magic_damage.sourceRule = MUL(
  SC(0.029999999, "MaximumChargeDamage.mMultiplier"),
  kledRSourceTarget,
);
Object.assign(param("kled_r", "damage_percent_points"), {
  description: "PercentHPBase索引1至3为4/6/8；源最小/最大mMultiplier分别是0.01/0.03，不再增加候选单位参数。",
});
Object.assign(param("kled_r", "minimum_charge_multiplier"), {
  description: "MinimumDamageTooltip.mMultiplier=0.01，已是最终比例系数。",
});
Object.assign(param("kled_r", "maximum_charge_multiplier"), {
  description: "MaximumChargeDamage.mMultiplier=0.03，已是最终比例系数。",
});

// Gnar Q、Quinn Q：1200/1550 来自 mSpell.missileSpeed，不是射程。
const renameParameter = (skillKey, oldKey, newKey, name, description) => {
  const item = param(skillKey, oldKey);
  item.parameterKey = newKey;
  item.name = name;
  item.description = description;
};
renameParameter("gnar_q", "missile_range", "missile_speed", "客户端飞弹速度", "mSpell.missileSpeed=1200；单位为速度，不能当作射程。");
renameParameter("quinn_q", "missile_range", "missile_speed", "客户端飞弹速度", "mSpell.missileSpeed=1550；mMissileSpec.movementComponent.mSpeed同为1550，不能当作射程。");

// 奎因 P：纯显形 4 秒属于明确范围外，不生成参数。
removeParam("quinn_p", "reveal_duration_ms");
candidate.skills.quinn_p.excluded = candidate.skills.quinn_p.excluded.map(item => item.item === "华洛独立单位、纯显形事件和野怪额外75伤害"
  ? { ...item, reason: "华洛独立单位、RevealDuration=4秒纯显形和野怪额外75伤害均为范围外；只保留人物自身标记普攻。" }
  : item);

// 奎因 R：SlowDuration=3 秒是受非小兵伤害移除加速的资格时长，不是 R 冷却。
const quinnRParameters = candidate.skills.quinn_r.write.parameters;
const quinnRInsertAt = quinnRParameters.findIndex(item => item.parameterKey === "active_duration_ms");
quinnRParameters.splice(quinnRInsertAt < 0 ? quinnRParameters.length : quinnRInsertAt, 0, {
  parameterKey: "non_minion_damage_removal_duration_ms",
  name: "非小兵受伤移除加速时长（毫秒）",
  valueType: "INTEGER",
  valueMode: "FIXED",
  fixedValue: 3000,
  levelValues: null,
  description: "QuinnR SlowDuration=3秒；非小兵伤害移除R移速的资格时长，不是R冷却；触发与恢复事件仍待接线。",
  sortOrder: 95,
});
candidate.skills.quinn_r.pending = candidate.skills.quinn_r.pending.map(item => item.item.startsWith("2秒引导后的实际退出时点")
  ? { ...item, item: "2秒引导后的实际退出时点、非小兵受伤移除与3秒恢复事件、侵扰标记时点", reason: "3秒资格时长已按SlowDuration单列；受伤触发、恢复和时序由事件层接线。" }
  : item);
candidate.skills.quinn_r.experience = "2秒引导结束后获得合体移速；退出时对附近英雄造成一次额外AD物理伤害并标记侵扰。非小兵伤害会移除加速3秒，时序仍待事件层接线。";

// 雷克塞 W：整套地底链范围外，已有 4000 毫秒公共冷却仅保护，不列待接。
candidate.skills.reksai_w.pending = [];
candidate.skills.reksai_w.experience = "本批不在W槽生成新参数或效果；遁地整链范围外，已有4000毫秒公共冷却仅作保护对象。";

const countComponents = () => {
  const counts = { newParameters: 0, newFormulas: 0, newEffects: 0, newProcesses: 0, newInternalStates: 0, newTriggerRules: 0 };
  for (const key of candidate.order) {
    const write = candidate.skills[key].write;
    counts.newParameters += write.parameters.length;
    counts.newFormulas += write.formulas.length;
    counts.newEffects += write.effects.length;
    counts.newProcesses += write.processes.length;
    counts.newInternalStates += write.internalStates.length;
    counts.newTriggerRules += write.triggerRules.length;
  }
  counts.newTotal = counts.newParameters + counts.newFormulas + counts.newEffects + counts.newProcesses + counts.newInternalStates + counts.newTriggerRules;
  counts.reusedPublicParameters = candidate.reusedPublicParameters.length;
  counts.plannedTotalIncludingReused = counts.newTotal + counts.reusedPublicParameters;
  counts.protectedCurrentCompositionLists = candidate.counts.protectedCurrentCompositionLists;
  return counts;
};
candidate.counts = countComponents();

// 计划从修订候选重建，初版只作为只读模板；重命名项使用新稳定键，新增项保留同技能的请求元数据。
const renameMap = new Map([
  ["gnar_q/missile_range", "missile_speed"],
  ["quinn_q/missile_range", "missile_speed"],
]);
const templateFor = (skillKey, kind, oldKey) => initialPlan.requests.find(request => request.skillKey === skillKey && request.kind === kind && request.stableKey === oldKey)
  || initialPlan.requests.find(request => request.skillKey === skillKey && request.kind === kind);
const requests = [];
for (const skillKey of candidate.order) {
  const write = candidate.skills[skillKey].write;
  for (const [kind, property] of [["parameters", "parameterKey"], ["formulas", "formulaKey"], ["effects", "effectKey"]]) {
    for (const item of write[kind]) {
      const reverseOldKey = [...renameMap.entries()].find(([oldPath, newKey]) => oldPath.startsWith(`${skillKey}/`) && newKey === item[property])?.[0]?.split("/")[1];
      const template = templateFor(skillKey, kind, reverseOldKey || item[property]);
      const request = template ? clone(template) : {
        operation: "POST",
        method: "POST",
        execute: false,
        status: "仅意图，未调用",
      };
      request.sequence = requests.length + 1;
      request.route = `/skills/${skillKey}/${kind}`;
      request.detailRoute = `/skills/${skillKey}/${kind}/${item[property]}`;
      request.skillKey = skillKey;
      request.kind = kind;
      request.stableKey = item[property];
      request.execute = false;
      request.status = "仅意图，未调用";
      request.body = clone(item);
      requests.push(request);
    }
  }
}
const plan = clone(initialPlan);
plan.generatedAt = new Date().toISOString();
plan.status = "修订一候选写前计划；未调用业务接口";
plan.revision = REVISION;
plan.requestCount = requests.length;
plan.counts = clone(candidate.counts);
plan.requests = requests;
plan.noApiCalls = true;
plan.apiWrites = 0;
plan.businessWrites = 0;

candidate.meta.generatedAt = plan.generatedAt;
writeJson(path.join(ROOT, "完整候选.json"), candidate);

for (const fileName of ["来源值与计算树.json", "来源值摘要.json"]) {
  const file = path.join(ROOT, fileName);
  const sourceValues = readJson(file);
  sourceValues.generatedAt = plan.generatedAt;
  sourceValues.revision = REVISION;
  sourceValues.status = "修订一固定来源值与计算树；未调用业务接口";
  sourceValues.noApiCalls = true;
  sourceValues.apiWrites = 0;
  for (const key of candidate.order) {
    const def = candidate.skills[key];
    sourceValues.values[key].selectedParameters = def.write.parameters.map(item => item.parameterKey);
    sourceValues.values[key].selectedFormulas = def.write.formulas.map(item => item.formulaKey);
    sourceValues.values[key].selectedEffects = def.write.effects.map(item => item.effectKey);
  }
  writeJson(file, sourceValues);
}

for (const fileName of ["来源与范围.json", "来源与范围核对.json"]) {
  const file = path.join(ROOT, fileName);
  const scope = readJson(file);
  scope.generatedAt = plan.generatedAt;
  scope.revision = REVISION;
  scope.status = "修订一候选范围与组成清单；未调用业务接口";
  scope.attributeChecks = "所有候选ATTRIBUTE节点、效果属性键及非空字典键由独立数学核算按当前保护快照校验；比例属性效果使用attribute_flat_add。";
  for (const key of candidate.order) {
    const def = candidate.skills[key];
    if (!scope.skills[key]) continue;
    scope.skills[key].parameters = def.write.parameters.map(item => item.parameterKey);
    scope.skills[key].formulas = def.write.formulas.map(item => item.formulaKey);
    scope.skills[key].effects = def.write.effects.map(item => item.effectKey);
    scope.skills[key].excluded = clone(def.excluded);
    scope.skills[key].pending = clone(def.pending);
    scope.skills[key].experience = def.experience;
  }
  writeJson(file, scope);
}

plan.candidateSha256 = null;
plan.sourceValuesSha256 = null;
plan.sourceScopeSha256 = null;
writeJson(path.join(ROOT, "请求计划.json"), plan);
writeJson(path.join(ROOT, "写前请求计划.json"), plan);
console.log(JSON.stringify({ revision: REVISION, parameters: candidate.counts.newParameters, formulas: candidate.counts.newFormulas, effects: candidate.counts.newEffects, requestCount: requests.length, status: "修订候选已生成，待独立数学" }, null, 2));
