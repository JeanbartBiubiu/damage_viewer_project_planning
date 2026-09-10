import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, "..", "..", "..", "..");
const DURABLE = path.join(REPO, "数据参考", "全量录入-2026-09", "交叉试录", "Luna", "英雄机制第四十九批", "修订三");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
const shaFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const candidateFile = path.join(ROOT, "完整候选.json");
const planFile = path.join(ROOT, "请求计划.json");
const preflightFile = path.join(ROOT, "写前请求计划.json");
const sourceValuesFile = path.join(ROOT, "来源值与计算树.json");
const sourceScopeFile = path.join(ROOT, "来源与范围核对.json");
const mathReportFile = path.join(ROOT, "独立数学报告.json");
const candidate = readJson(candidateFile);
const plan = readJson(planFile);
const sourceValues = readJson(sourceValuesFile);
const sourceScope = readJson(sourceScopeFile);
const mathReport = readJson(mathReportFile);
if (mathReport.status !== "通过" || mathReport.failures?.length) throw new Error("独立数学未通过，不能冻结");
const generatedAt = new Date().toISOString();
const revision = candidate.meta.revision;
const finalStatus = "修订三候选已冻结，独立数学已通过；等待主负责人保存；未调用业务接口";

candidate.revision = revision;
candidate.meta.status = finalStatus;
candidate.meta.finalizedAt = generatedAt;
candidate.meta.mathReport = "独立数学报告.json";
candidate.meta.mathReportSha256 = shaFile(mathReportFile);
candidate.meta.mathSummary = {
  formulaCount: mathReport.formulaCount,
  formulaScenarios: mathReport.formulaScenarios,
  sourceMatches: mathReport.sourceMatches,
  missingRuntimeCases: mathReport.missingRuntimeCases,
  missingRuntimeRejected: mathReport.missingRuntimeRejected,
  dictionaryKeyCheckCount: mathReport.dictionaryKeyCheckCount,
  integerParameterCount: mathReport.integerParameterCount,
  integerValueCount: mathReport.integerValueCount,
};
candidate.meta.apiCalls = 0;
candidate.meta.businessWrites = 0;
candidate.meta.browserCalls = 0;
candidate.meta.gitWrites = 0;
candidate.apiWrites = {
  post: false,
  requestsOnly: true,
  requestCount: candidate.counts.newTotal,
  status: "仅保留请求意图，未调用业务接口",
};
candidate.noApiCalls = true;
candidate.businessWrites = 0;
candidate.browserCalls = 0;
candidate.gitWrites = 0;
writeJson(candidateFile, candidate);

const candidateSha256 = shaFile(candidateFile);
const sourceValuesSha256 = shaFile(sourceValuesFile);
const sourceScopeSha256 = shaFile(sourceScopeFile);
const mathReportSha256 = shaFile(mathReportFile);

Object.assign(plan, {
  generatedAt: plan.generatedAt || generatedAt,
  finalizedAt: generatedAt,
  revision,
  status: finalStatus,
  candidateSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  sourceMath: "独立数学核算.mjs",
  sourceMathReport: "独立数学报告.json",
  sourceMathReportSha256: mathReportSha256,
  sourceMathStatus: mathReport.status,
  requestCount: plan.requests.length,
  counts: candidate.counts,
  noApiCalls: true,
  apiWrites: 0,
  businessWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
});
writeJson(planFile, plan);
fs.copyFileSync(planFile, preflightFile);
const planSha256 = shaFile(planFile);

const versionFile = path.join(ROOT, "候选版本.json");
const version = readJson(versionFile);
Object.assign(version, {
  generatedAt: version.generatedAt || generatedAt,
  finalizedAt: generatedAt,
  batch: candidate.meta.batch,
  revision,
  status: finalStatus,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  sourceMath: "独立数学核算.mjs",
  sourceMathReport: "独立数学报告.json",
  sourceMathReportSha256: mathReportSha256,
  sourceMathStatus: mathReport.status,
  math: {
    formulaCount: mathReport.formulaCount,
    formulaScenarios: mathReport.formulaScenarios,
    sourceMatches: mathReport.sourceMatches,
    sourceRuleMatches: mathReport.sourceRuleMatches,
    rawCalculationMatches: mathReport.rawCalculationMatches,
    missingRuntimeCases: mathReport.missingRuntimeCases,
    missingRuntimeRejected: mathReport.missingRuntimeRejected,
    integerParameterCount: mathReport.integerParameterCount,
    integerParameterPassCount: mathReport.integerParameterPassCount,
    integerValueCount: mathReport.integerValueCount,
    integerValuePassCount: mathReport.integerValuePassCount,
    dictionaryKeyCheckCount: mathReport.dictionaryKeyCheckCount,
    dictionaryKeyPassCount: mathReport.dictionaryKeyPassCount,
    gnarMoveSpeedAssertions: mathReport.gnarMoveSpeedAssertions.length,
    kledRLevelAssertions: mathReport.kledRLevelAssertions.length,
    missileSpeedAssertions: mathReport.missileSpeedAssertions.length,
    failures: mathReport.failures.length,
    tolerance: mathReport.tolerance,
  },
  counts: candidate.counts,
  requestCount: plan.requestCount,
  inputGETs: version.inputGETs || 186,
  publicReuseCount: candidate.counts.reusedPublicParameters,
  apiCalls: 0,
  businessWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
});
writeJson(versionFile, version);

const summaryFile = path.join(ROOT, "来源哈希汇总.json");
const summary = readJson(summaryFile);
Object.assign(summary, {
  finalizedAt: generatedAt,
  revision,
  status: finalStatus,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  mathReportSha256,
  mathStatus: mathReport.status,
  counts: candidate.counts,
  requestCount: plan.requestCount,
  apiCalls: 0,
  businessWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
});
writeJson(summaryFile, summary);

const indexFile = path.join(ROOT, "候选登记.json");
const index = readJson(indexFile);
Object.assign(index, {
  revision,
  finalizedAt: generatedAt,
  status: finalStatus,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  mathReportSha256,
  mathStatus: mathReport.status,
  counts: candidate.counts,
  requestCount: plan.requestCount,
  noApiCalls: true,
  apiWrites: 0,
  businessWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
});
writeJson(indexFile, index);

const registration = [
  "# 第四十九批候选登记（修订三）",
  "",
  "本目录是纳尔、克烈、奎因、雷克塞20个技能槽的修订候选。候选已冻结，等待主负责人保存；业务接口、数据库、浏览器和战斗运行均未调用。",
  "",
  `独立数学核算已通过：${mathReport.formulaCount}个公式、${mathReport.formulaScenarios}个场景、${mathReport.sourceMatches}个原始来源匹配；${mathReport.missingRuntimeRejected}个缺运行输入场景全部拒绝，失败0。另核对${mathReport.integerParameterCount}个整数参数、${mathReport.integerValueCount}个整数值、${mathReport.dictionaryKeyCheckCount}个非空字典引用、${mathReport.gnarMoveSpeedAssertions.length}个纳尔移速档、${mathReport.kledRLevelAssertions.length}个克烈R场景和${mathReport.missileSpeedAssertions.length}个飞弹速度字段。`,
  "",
  "Cursor来源复核为READY（2946事件、79个唯一工具、24项冻结输入），只代表来源审查完成，不代表候选已保存。",
  "",
  `候选散列：${candidateSha256}`,
  "",
  `请求计划散列：${planSha256}`,
  "",
  `来源值散列：${sourceValuesSha256}`,
  "",
  `范围清单散列：${sourceScopeSha256}`,
  "",
  `数学报告散列：${mathReportSha256}`,
  "",
  `新增参数/公式/效果：${candidate.counts.newParameters}/${candidate.counts.newFormulas}/${candidate.counts.newEffects}；公共参数只读复用：${candidate.counts.reusedPublicParameters}；新增请求：${plan.requestCount}。`,
].join("\n") + "\n";
fs.writeFileSync(path.join(ROOT, "候选登记.md"), registration, "utf8");

const manifest = {
  generatedAt,
  batch: candidate.meta.batch,
  revision,
  status: finalStatus,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  mathReportSha256,
  files: {},
  note: "按文件字节计算；本清单自身不列入files，避免自引用。",
};
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(item => item.isFile() && item.name !== "文件散列.json")
  .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))) {
  const file = path.join(ROOT, entry.name);
  manifest.files[entry.name] = { sha256: shaFile(file), byteSize: fs.statSync(file).size };
}
writeJson(path.join(ROOT, "文件散列.json"), manifest);

fs.mkdirSync(DURABLE, { recursive: true });
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.isFile()) fs.copyFileSync(path.join(ROOT, entry.name), path.join(DURABLE, entry.name));
}
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true }).filter(item => item.isFile())) {
  const target = path.join(DURABLE, entry.name);
  if (!fs.existsSync(target) || shaFile(path.join(ROOT, entry.name)) !== shaFile(target)) {
    throw new Error(`持久目录字节不一致：${entry.name}`);
  }
}
if (shaFile(path.join(ROOT, "文件散列.json")) !== shaFile(path.join(DURABLE, "文件散列.json"))) {
  throw new Error("持久目录散列清单不一致");
}
console.log(JSON.stringify({
  status: mathReport.status,
  revision,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  mathReportSha256,
  files: Object.keys(manifest.files).length,
  durable: DURABLE,
  counts: candidate.counts,
  requestCount: plan.requestCount,
  apiCalls: 0,
  browserCalls: 0,
  businessWrites: 0,
  gitWrites: 0,
}, null, 2));
