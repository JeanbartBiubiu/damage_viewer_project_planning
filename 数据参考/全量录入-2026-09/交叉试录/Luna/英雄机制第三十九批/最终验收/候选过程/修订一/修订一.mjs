import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const writeJson = (name, value) => fs.writeFileSync(path.join(ROOT, name), JSON.stringify(value, null, 2) + "\n", "utf8");
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const candidate = read("完整候选.json");
const oldPlan = read("请求计划.json");
const range = read("来源与范围.json");
const sourceValues = read("来源值摘要.json");
const oldHashes = read("来源哈希汇总.json");
const revision = "hero39-source-v1-revision-1";
const inputCandidateRevision = candidate.meta.revision === revision
  ? (candidate.meta.baselineRevision || "hero39-source-v1")
  : candidate.meta.revision;
const oldHealingBasisKey = "actual_current_enemy_pre_mitigation_damage";
const newHealingBasisKey = "actual_current_enemy_healing_basis_damage";

candidate.meta.revision = revision;
candidate.meta.status = "修订一候选已生成，等待主负责人审查；未调用业务接口";
candidate.meta.candidateSha256 = null;
candidate.revision = revision;
const urgotWDuration = candidate.skills.urgot_w.write.parameters.find(item => item.parameterKey === "finite_duration_ms");
if (!urgotWDuration) throw new Error("缺少厄加特W finite_duration_ms");
urgotWDuration.valueMode = "FIXED";
urgotWDuration.fixedValue = 4000;
urgotWDuration.levelValues = null;
urgotWDuration.description = "当前正文和原始Duration说明等级1至4为4秒；本参数固定保存有限窗口4000毫秒，等级5的25000是开关占位，不能写入有限等级映射或转换成25000000毫秒。";
const nilahR = candidate.skills.nilah_r;
const duration = nilahR.write.parameters.find(item => item.parameterKey === "duration_ms");
if (!duration) throw new Error("缺少尼菈R duration_ms");
duration.fixedValue = 1000;
duration.description = "当前正文明确在1秒里持续造成伤害，转换为1000毫秒；过量治疗护盾另由overheal_shield_duration_ms保存6秒，不能混用技能持续。";
const healingBasis = nilahR.write.parameters.find(item => item.parameterKey === oldHealingBasisKey);
if (!healingBasis) throw new Error("缺少尼菈R治疗基准输入");
healingBasis.parameterKey = newHealingBasisKey;
healingBasis.name = "神恩激荡当前敌方治疗基准伤害";
healingBasis.description = "自身治疗量需要当前目标合资格伤害作为实际输入；折前或折后阶段尚无当前文本和计算树证据，使用中性实际治疗基准伤害，不设默认。";
const replaceParameterKey = node => {
  if (!node || typeof node !== "object") return;
  if (node.nodeType === "PARAMETER" && node.parameterKey === oldHealingBasisKey) node.parameterKey = newHealingBasisKey;
  if (Array.isArray(node)) node.forEach(replaceParameterKey);
  else Object.values(node).forEach(replaceParameterKey);
};
for (const formula of nilahR.write.formulas) replaceParameterKey(formula.expression);

const order = candidate.order;
const plan = {
  ...oldPlan,
  revision,
  status: "仅写入意图，未调用业务接口；修订一保留基线候选字节并修复三项语义",
  candidateSha256: null,
  sourceRangeSha256: null,
  requestCount: 0,
  counts: JSON.parse(JSON.stringify(candidate.counts)),
  requests: [],
  noApiCalls: true,
  apiWrites: 0,
  businessWrites: 0,
};
for (const skillKey of order) {
  const write = candidate.skills[skillKey].write;
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
      plan.requests.push({
        sequence: plan.requests.length + 1,
        operation: "POST",
        method: "POST",
        route: "/skills/" + skillKey + "/" + kind,
        detailRoute: "/skills/" + skillKey + "/" + kind + "/" + stableKey,
        skillKey,
        kind,
        stableKey,
        status: "仅意图，未调用",
        body: JSON.parse(JSON.stringify(body)),
      });
    }
  }
}
plan.requestCount = plan.requests.length;
if (plan.requestCount !== candidate.counts.newTotal) throw new Error("修订一请求数量不符");

range.revision = revision;
range.status = "第39批修订一范围与来源选择；未调用业务接口";
range.skills.nilah_r.recordableParameters = nilahR.write.parameters.map(item => item.parameterKey);
range.skills.urgot_w.recordableParameters = candidate.skills.urgot_w.write.parameters.map(item => item.parameterKey);
range.noApiCalls = true;
range.apiWrites = 0;

if (sourceValues.sourceValues?.nilah_r) {
  sourceValues.sourceValues.nilah_r.selectedParameterKeys = nilahR.write.parameters.map(item => item.parameterKey);
}
sourceValues.revision = revision;
sourceValues.status = "修订一独立来源值摘要；未调用业务接口";
sourceValues.noApiCalls = true;
sourceValues.apiWrites = 0;

const candidateBytes = bytes(candidate);
const candidateSha256 = sha(candidateBytes);
const rangeBytes = bytes(range);
const rangeSha256 = sha(rangeBytes);
const sourceValuesBytes = bytes(sourceValues);
const sourceValuesSha256 = sha(sourceValuesBytes);
plan.candidateSha256 = candidateSha256;
plan.sourceRangeSha256 = rangeSha256;
const planBytes = bytes(plan);
const planSha256 = sha(planBytes);

const version = {
  ...read("候选版本.json"),
  revision,
  status: "修订一候选冻结，待独立审查；未调用业务接口",
  candidateSha256,
  planSha256,
  rangeSha256,
  sourceValuesSha256,
  counts: JSON.parse(JSON.stringify(candidate.counts)),
  requestCount: plan.requestCount,
  sourceMath: "独立源值数学.mjs",
  sourceMathStatus: "待执行",
  apiCalls: 0,
  businessWrites: 0,
  noBusinessWrites: true,
  baselineRevision: inputCandidateRevision,
  revisionChanges: [
    "尼菈R技能持续改为正文1秒对应1000毫秒；过量治疗护盾仍为独立6000毫秒。",
    "厄加特W有限持续参数改为固定4000毫秒，避免技能等级1至4的非完整等级映射被接口拒绝；等级5开关另列。",
    "尼菈R治疗基准输入改为中性actual_current_enemy_healing_basis_damage，删除无来源的折前断言，公式结构不变。",
  ],
};
const hashes = {
  ...oldHashes,
  revision,
  files: {
    ...(oldHashes.files || {}),
    candidateSha256,
    planSha256,
    rangeSha256,
    sourceValuesSha256,
  },
  candidateSha256,
  planSha256,
  rangeSha256,
  sourceValuesSha256,
  inputCandidateRevision,
  apiCalls: 0,
  businessWrites: 0,
};
const fileHashes = {
  candidateSha256,
  planSha256,
  rangeSha256,
  sourceValuesSha256,
  sourceBindingSha256: candidate.meta.sourceBindingSha256,
  protectionSnapshotSha256: candidate.meta.protectionSnapshotSha256,
  publicReuseSha256: candidate.meta.publicReuseSha256,
  revision,
  baselineRevision: inputCandidateRevision,
};
writeJson("完整候选.json", candidate);
writeJson("请求计划.json", plan);
writeJson("来源与范围.json", range);
writeJson("来源值摘要.json", sourceValues);
writeJson("候选版本.json", version);
writeJson("来源哈希汇总.json", hashes);
writeJson("文件散列.json", fileHashes);
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8")
  .replace("# 第三十九批候选", "# 第三十九批候选（修订一）\n\n本目录保留基线候选 `../完整候选.json` 及其哈希；本文件是修订一的可审查版本。")
  .replace("当前未调用业务接口，候选请求计划只表达待审写入意图。", "当前未调用业务接口，候选请求计划只表达待审写入意图。修订一修正尼菈R的1秒技能持续、厄加特W有限持续的完整映射要求，以及尼菈R治疗基准的中性命名。")
  .replace("尼菈跳过P但保留Q/W/R自身收益、E两次充能和R四倍展示式", "尼菈跳过P但保留Q/W/R自身收益、E两次充能和R四倍展示式；R持续伤害为正文1秒，护盾持续另为6秒")
  .replace("未知属性槽、等级中间曲线", "未知属性槽、等级中间曲线");
fs.writeFileSync(path.join(ROOT, "README.md"), readme, "utf8");
const experience = fs.readFileSync(path.join(ROOT, "体验报告.md"), "utf8")
  + "\n\n修订一记录：尼菈R的技能持续与过量治疗护盾持续分开为1000/6000毫秒；厄加特W有限持续改为固定4000毫秒并保留满级开关事实；尼菈R治疗基准改为中性实际输入，折前或折后阶段仍待核。基线候选与本修订字节均保留。\n";
fs.writeFileSync(path.join(ROOT, "体验报告.md"), experience, "utf8");
console.log(JSON.stringify({ revision, candidateSha256, planSha256, rangeSha256, sourceValuesSha256, counts: candidate.counts, requestCount: plan.requestCount, baselineRevision: inputCandidateRevision }, null, 2));
