import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGINAL = path.resolve(HERE, "..");
const DURABLE = path.resolve("C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十一批/修订一");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
const sha = value => crypto.createHash("sha256").update(bytes(value)).digest("hex");
const shaFile = file => sha(fs.readFileSync(file));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, "utf8"); };
const clone = value => JSON.parse(JSON.stringify(value));
const candidate = readJson(path.join(ORIGINAL, "完整候选.json"));
const originalCandidateSha256 = shaFile(path.join(ORIGINAL, "完整候选.json"));
const originalPlan = readJson(path.join(ORIGINAL, "请求计划.json"));
candidate.meta.revision = "hero41-source-v1-luna-revision-1";
candidate.meta.generatedAt = new Date().toISOString();
candidate.meta.status = "修订一候选，等待主负责人审查；未调用业务接口";
candidate.meta.candidateFileSha256 = null;
candidate.sourceNotes.semantics = "保留自身护盾、治疗和属性收益及同一敌人重复/再施放数值；移除未经证实的米利欧W自身攻击距离效果、烈娜塔Q另一敌人晕眩和巴德P额外敌人升级公式。";

const bardP = candidate.skills.bard_p;
bardP.write.parameters = bardP.write.parameters.filter(item => !["chimes_splash_damage_multiplier", "chimes_splash_area_multiplier"].includes(item.parameterKey));
bardP.write.formulas = bardP.write.formulas.filter(item => !["chimes_for_splash_damage_upgrade", "chimes_for_splash_area_upgrade"].includes(item.formulaKey));
bardP.excluded.push({ item: "额外敌人范围伤害与范围扩大升级阈值", reason: "只保留单敌调和层数伤害间隔；额外敌人范围升级本轮不建立参数或公式。" });

const milioW = candidate.skills.milio_w;
milioW.write.effects = milioW.write.effects.filter(item => item.effectKey !== "self_attack_range");
milioW.pending.push({ item: "自身攻击距离基础映射和效果接线", reason: "当前比例树存在，但攻击距离基准未证，不能建立属性效果。" });
milioW.proofNote = "保留自身可能受益的比例公式和治疗数值；攻击距离基准未证，不创建自身属性效果。";

const renataQ = candidate.skills.renata_q;
renataQ.write.parameters = renataQ.write.parameters.filter(item => item.parameterKey !== "stun_duration_ms");
renataQ.excluded.push({ item: "被拉目标碰撞产生的晕眩", reason: "属于另一敌人/碰撞分支，本轮只保留当前唯一目标的首段与再施放数据。" });

for (const effect of candidate.skills.rakan_r.write.effects) {
  if (["self_initial_move_speed", "self_touch_move_speed"].includes(effect.effectKey)) {
    const result = effect.results?.[0];
    if (result?.valueRule) {
      result.valueRule.fixedMultiplier = 0.01;
      if (result.detail) result.detail.modifierZoneKey = "attribute_flat_add";
    }
  }
}

const order = candidate.order;
const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const routes = { parameters: "parameters", formulas: "formulas", effects: "effects", processes: "processes", internalStates: "internal-states", triggerRules: "trigger-rules" };
const keys = { parameters: "parameterKey", formulas: "formulaKey", effects: "effectKey", processes: "processKey", internalStates: "stateKey", triggerRules: "ruleKey" };
const writes = order.flatMap(skillKey => kinds.flatMap(kind => candidate.skills[skillKey].write[kind].map(body => ({ skillKey, kind, body }))));
const requestCounts = Object.fromEntries(kinds.map(kind => [kind, writes.filter(item => item.kind === kind).length]));
const requests = writes.map((item, index) => {
  const stableKey = item.body[keys[item.kind]];
  if (!stableKey) throw new Error(`缺少稳定键 ${item.skillKey}/${item.kind}`);
  return { sequence: index + 1, method: "POST", route: "/skills/" + item.skillKey + "/" + routes[item.kind], detailRoute: "/skills/" + item.skillKey + "/" + routes[item.kind] + "/" + stableKey, skillKey: item.skillKey, kind: item.kind, stableKey, status: "仅意图，未调用", body: item.body };
});
candidate.counts = { ...candidate.counts, newParameters: requestCounts.parameters, newFormulas: requestCounts.formulas, newEffects: requestCounts.effects, newProcesses: requestCounts.processes, newInternalStates: requestCounts.internalStates, newTriggerRules: requestCounts.triggerRules, newTotal: requests.length, plannedTotalIncludingReused: requests.length + candidate.reusedPublicParameters.length };
candidate.apiWrites = 0;
candidate.meta.apiCalls = 0;
candidate.meta.businessWrites = 0;
const candidateBytes = JSON.stringify(candidate, null, 2) + "\n";
const candidateSha256 = sha(candidateBytes);

const plan = { ...originalPlan, generatedAt: new Date().toISOString(), revision: candidate.meta.revision, candidateSha256, requestCount: requests.length, requestCounts, currentTotalComponents: requests.length + candidate.reusedPublicParameters.length, requests, status: "修订一仅写入意图，未调用业务接口；候选等待主负责人审查", apiCalls: 0, apiWrites: 0 };
const planBytes = JSON.stringify(plan, null, 2) + "\n";
const planSha256 = sha(planBytes);

const sourceValues = readJson(path.join(ORIGINAL, "来源值摘要.json"));
sourceValues.generatedAt = new Date().toISOString();
sourceValues.revision = candidate.meta.revision;
sourceValues.status = "修订一独立原始源值摘要；未调用业务接口";
for (const key of order) {
  const skill = candidate.skills[key];
  sourceValues.selectedValues[key].selectedParameters = skill.write.parameters.map(item => ({ parameterKey: item.parameterKey, name: item.name, valueType: item.valueType, valueMode: item.valueMode, fixedValue: item.fixedValue, levelValues: item.levelValues }));
  sourceValues.selectedValues[key].formulas = skill.write.formulas.map(item => ({ formulaKey: item.formulaKey, expression: item.expression }));
  sourceValues.selectedValues[key].excluded = skill.excluded;
  sourceValues.selectedValues[key].pending = skill.pending;
}
const sourceValuesBytes = JSON.stringify(sourceValues, null, 2) + "\n";
const sourceValuesSha256 = sha(sourceValuesBytes);

const originalScope = readJson(path.join(ORIGINAL, "来源与范围.json"));
const sourceScope = { ...originalScope, generatedAt: new Date().toISOString(), revision: candidate.meta.revision, status: "修订一候选阶段，未调用业务接口", counts: candidate.counts, requestCount: requests.length, perSkill: Object.fromEntries(order.map(key => [key, { excluded: candidate.skills[key].excluded, pending: candidate.skills[key].pending }])) };
const sourceScopeBytes = JSON.stringify(sourceScope, null, 2) + "\n";

const originalHashes = readJson(path.join(ORIGINAL, "来源哈希汇总.json"));
const sourceHashes = { ...originalHashes, generatedAt: new Date().toISOString(), revision: candidate.meta.revision, outputs: { candidateSha256, planSha256, sourceValuesSha256 }, originalFrozenOutputs: { candidateSha256: originalHashes.outputs.candidateSha256, planSha256: originalHashes.outputs.planSha256, sourceValuesSha256: originalHashes.outputs.sourceValuesSha256 }, apiCalls: 0, apiWrites: 0 };
const sourceHashesBytes = JSON.stringify(sourceHashes, null, 2) + "\n";

const originalVersion = readJson(path.join(ORIGINAL, "候选版本.json"));
const version = { ...originalVersion, generatedAt: new Date().toISOString(), revision: candidate.meta.revision, status: "revision-1-candidate", candidateSha256, planSha256, sourceValuesSha256, counts: candidate.counts, requestCount: requests.length, apiCalls: 0, apiWrites: 0 };
const versionBytes = JSON.stringify(version, null, 2) + "\n";

const difference = {
  generatedAt: new Date().toISOString(), batch: candidate.meta.batch, revision: candidate.meta.revision,
  originalFrozen: { candidateSha256: originalCandidateSha256, planSha256: shaFile(path.join(ORIGINAL, "请求计划.json")), sourceValuesSha256: shaFile(path.join(ORIGINAL, "来源值摘要.json")) },
  changes: [
    { skillKey: "rakan_r", type: "effect-value-rule", effectKeys: ["self_initial_move_speed", "self_touch_move_speed"], beforeFixedMultiplier: 1, afterFixedMultiplier: 0.01, reason: "百分点参数写入move_speed_percent前转换为系统比例。" },
    { skillKey: "rakan_r", type: "modifier-zone", effectKeys: ["self_initial_move_speed", "self_touch_move_speed"], beforeModifierZoneKey: "attribute_percent_bonus", afterModifierZoneKey: "attribute_flat_add", reason: "当前move_speed_percent本身是比例属性；沿当前标准使用平加区，跨批次同类映射仍列入集中统一复核。" },
    { skillKey: "milio_w", type: "remove-effect", effectKey: "self_attack_range", reason: "攻击距离基准未证，移除未经证明的属性效果，保留比例公式。" },
    { skillKey: "renata_q", type: "remove-parameter", parameterKey: "stun_duration_ms", reason: "另一敌人碰撞分支，移出本轮。" },
    { skillKey: "bard_p", type: "remove-formulas-and-parameters", formulaKeys: ["chimes_for_splash_damage_upgrade", "chimes_for_splash_area_upgrade"], parameterKeys: ["chimes_splash_damage_multiplier", "chimes_splash_area_multiplier"], reason: "额外敌人范围升级移出本轮，单敌chime_damage_checkpoint保留。" },
  ],
  counts: { original: originalPlan.requestCount, revision: requests.length, delta: requests.length - originalPlan.requestCount }, apiCalls: 0, apiWrites: 0,
};
const readme = [
  "# 第四十一批候选修订一", "", "本目录是41批原候选的隔离修订，不覆盖原冻结文件。修订只处理四项验收问题：洛R百分比效果倍率及修饰区、米利欧W未经证实的自身攻击距离效果、烈娜塔Q另一敌人晕眩参数、巴德P额外敌人升级公式。", "",
  `修订后新增${requests.length}项：${requestCounts.parameters}参数、${requestCounts.formulas}公式、${requestCounts.effects}效果；25个公共参数仍只复用。`, "", "原候选、原计划、原数学和原报告仍在上级目录作为字节证据；本目录的独立数学报告从修订候选表达式和冻结原始源值重新核算。业务接口调用为0。", "",
  "入口：完整候选.json、请求计划.json、修订差异.json、独立数学核算.mjs、独立数学核算.json、来源值摘要.json、来源与范围.json、来源哈希汇总.json、候选版本.json、体验报告.md。",
].join("\n") + "\n";
const experience = [
  "# 第四十一批修订一体验记录", "", "本轮仅在隔离目录生成候选与核算文件，未调用业务接口。原冻结候选和来源文件未覆盖。", "", "- 洛R自身移速两个属性效果现在将75/150百分点按0.01转为系统比例，并将已是比例属性的结果放入平加区；来源参数仍保留原百分点。当前批采用该标准，跨批次同类映射另列集中统一复核。", "- 米利欧W保留攻击距离比例公式与自身资格待核，移除没有已证攻击距离基准的属性效果。", "- 烈娜塔Q移除属于另一敌人碰撞分支的晕眩参数。", "- 巴德P保留单敌每5层伤害间隔，移除额外敌人范围升级公式和乘数。", "", "修订数学由独立脚本从冻结原始树取期望，候选阶段通过后仍需主负责人决定是否写入。", "",
].join("\n");

const files = {
  "完整候选.json": candidateBytes, "请求计划.json": planBytes, "来源值摘要.json": sourceValuesBytes, "来源与范围.json": sourceScopeBytes,
  "来源哈希汇总.json": sourceHashesBytes, "候选版本.json": versionBytes, "修订差异.json": JSON.stringify(difference, null, 2) + "\n", "README.md": readme, "体验报告.md": experience,
};
for (const [name, content] of Object.entries(files)) write(path.join(HERE, name), content);
fs.mkdirSync(DURABLE, { recursive: true });
for (const [name, content] of Object.entries(files)) { write(path.join(DURABLE, name), content); if (shaFile(path.join(HERE, name)) !== shaFile(path.join(DURABLE, name))) throw new Error("修订文件字节不一致：" + name); }

const originalMath = fs.readFileSync(path.join(ORIGINAL, "独立数学核算.mjs"), "utf8");
const mathScript = originalMath
  .replace("const INPUT = path.resolve(HERE, \"..\", \"hero41-root-entry-20260910\");", "const INPUT = path.resolve(HERE, \"..\", \"..\", \"hero41-root-entry-20260910\");")
  .replace("const DURABLE = path.resolve(\"C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十一批\");", "const DURABLE = path.resolve(\"C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第四十一批/修订一\");")
  .replace("assert(structural.formulaCount === 31, `公式数量不是31：${structural.formulaCount}`);", "assert(structural.formulaCount === 29, `公式数量不是29：${structural.formulaCount}`);");
write(path.join(HERE, "独立数学核算.mjs"), mathScript);
write(path.join(DURABLE, "独立数学核算.mjs"), mathScript);
console.log(JSON.stringify({ revision: candidate.meta.revision, counts: candidate.counts, requestCount: requests.length, candidateSha256, planSha256, sourceValuesSha256, originalCandidateSha256, mathScriptPatched: mathScript.includes("英雄机制第四十一批/修订一"), apiCalls: 0, apiWrites: 0 }, null, 2));
