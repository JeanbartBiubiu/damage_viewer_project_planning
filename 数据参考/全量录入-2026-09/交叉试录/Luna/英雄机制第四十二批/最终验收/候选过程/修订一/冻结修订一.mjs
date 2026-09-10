import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const shaFile = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const candidateFile = path.join(HERE, "完整候选.json");
const planFile = path.join(HERE, "写前请求计划.json");
const versionFile = path.join(HERE, "候选版本.json");
const mathFile = path.join(HERE, "独立数学核算.json");
const candidate = readJson(candidateFile);
const plan = readJson(planFile);
const version = readJson(versionFile);
const math = readJson(mathFile);
if (math.status !== "通过" || math.candidateMathReady !== true || math.issueCount !== undefined && math.issueCount !== 0 || math.issues?.length) throw new Error("独立数学核对未通过，不能冻结");
const candidateSha256 = shaFile(candidateFile);
const planSha256 = shaFile(planFile);
const mathSha256 = shaFile(mathFile);
if (candidateSha256 !== version.candidateSha256 || candidateSha256 !== plan.candidateSha256 || candidateSha256 !== math.candidateSha256) throw new Error("候选散列链不一致");
if (planSha256 !== version.planSha256) throw new Error("请求计划散列链不一致");
const generatedAt = new Date().toISOString();
const finalVersion = {
  ...version,
  generatedAt,
  status: "修订一候选冻结，独立数学核对通过，待主负责人审查；未调用业务接口",
  independentMathSha256: mathSha256,
  mathSummary: {
    formulaCount: math.formulaCount,
    caseCount: math.caseCount,
    formulaPassCount: math.formulaPassCount,
    formulaFailCount: math.formulaFailCount,
    missingInputCaseCount: math.missingInputCaseCount,
    missingInputRejectedCount: math.missingInputRejectedCount,
    integerParameters: math.structural.integerParameters,
    integerValues: math.structural.integerValues,
    binaryOperations: math.structural.binaryOperations,
    formulaReferenceNodes: math.structural.formulaReferenceNodes,
  },
  apiCalls: 0,
  apiWrites: 0,
  businessWrites: 0,
  noBusinessWrites: true,
};
fs.writeFileSync(versionFile, jsonBytes(finalVersion), "utf8");
const finalVersionSha256 = shaFile(versionFile);
const notice = {
  generatedAt,
  batch: "英雄机制第四十二批",
  revision: candidate.revision,
  status: "修订一候选冻结，独立数学核对通过，待主负责人审查；未调用业务接口",
  original: {
    candidateSha256: candidate.meta.baseCandidateSha256,
    requestPlanSha256: candidate.meta.baseRequestPlanSha256,
  },
  revised: {
    candidateSha256,
    requestPlanSha256: planSha256,
    versionSha256: finalVersionSha256,
    independentMathSha256: mathSha256,
  },
  counts: candidate.counts,
  requestCount: plan.requestCount,
  math: {
    status: math.status,
    formulaCount: math.formulaCount,
    caseCount: math.caseCount,
    formulaPassCount: math.formulaPassCount,
    missingInputRejected: `${math.missingInputRejectedCount}/${math.missingInputCaseCount}`,
    issueCount: math.issues.length,
  },
  apiCalls: 0,
  apiWrites: 0,
  browserCalls: 0,
  businessWrites: 0,
  noBusinessWrites: true,
};
const noticeFile = path.join(HERE, "冻结通知.json");
fs.writeFileSync(noticeFile, jsonBytes(notice), "utf8");
const hashManifest = {
  generatedAt,
  revision: candidate.revision,
  files: {
    candidate: { path: "完整候选.json", sha256: candidateSha256 },
    requestPlan: { path: "写前请求计划.json", sha256: planSha256 },
    version: { path: "候选版本.json", sha256: finalVersionSha256 },
    mathScript: { path: "独立数学核算.mjs", sha256: shaFile(path.join(HERE, "独立数学核算.mjs")) },
    mathReport: { path: "独立数学核算.json", sha256: mathSha256 },
    generator: { path: "生成修订候选.mjs", sha256: shaFile(path.join(HERE, "生成修订候选.mjs")) },
    freezer: { path: "冻结修订一.mjs", sha256: shaFile(path.join(HERE, "冻结修订一.mjs")) },
    note: { path: "修订说明.md", sha256: shaFile(path.join(HERE, "修订说明.md")) },
    notice: { path: "冻结通知.json", sha256: shaFile(noticeFile) },
  },
};
fs.writeFileSync(path.join(HERE, "文件散列.json"), jsonBytes(hashManifest), "utf8");
console.log(JSON.stringify({ revision: candidate.revision, candidateSha256, planSha256, versionSha256: finalVersionSha256, independentMathSha256: mathSha256, noticeSha256: shaFile(noticeFile), counts: candidate.counts, requestCount: plan.requestCount, apiCalls: 0, apiWrites: 0, businessWrites: 0 }, null, 2));
