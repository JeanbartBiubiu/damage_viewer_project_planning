import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const bytes = file => fs.readFileSync(file);
const sha = file => crypto.createHash("sha256").update(bytes(file)).digest("hex");
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const writeJson = (file, value) => fs.writeFileSync(file, jsonBytes(value));
const candidateFile = path.join(here, "完整候选.json");
const planFile = path.join(here, "请求计划.json");
const sourceValuesFile = path.join(here, "来源值摘要.json");
const sourceScopeFile = path.join(here, "来源与范围.json");
const sourceChangeFile = path.join(here, "来源变更说明.md");
const mathScriptFile = path.join(here, "独立数学核算.mjs");
const mathReportFile = path.join(here, "独立数学报告.json");
const versionFile = path.join(here, "候选版本.json");
const hashFile = path.join(here, "来源哈希汇总.json");
const freezeFile = path.join(here, "来源冻结通知.json");
const report = readJson(mathReportFile);
if (report.status !== "通过" || report.failures?.length) throw new Error("独立数学报告未通过，停止更新元信息");

const candidateSha256 = sha(candidateFile);
const planSha256 = sha(planFile);
const sourceValuesSha256 = sha(sourceValuesFile);
const sourceScopeSha256 = sha(sourceScopeFile);
const sourceChangeNoteSha256 = sha(sourceChangeFile);
const mathScriptSha256 = sha(mathScriptFile);
const mathReportSha256 = sha(mathReportFile);
const version = readJson(versionFile);
version.status = "修订一候选和数学核算已完成，未调用业务接口";
version.candidateSha256 = candidateSha256;
version.planSha256 = planSha256;
version.sourceValuesSha256 = sourceValuesSha256;
version.sourceScopeSha256 = sourceScopeSha256;
version.sourceChangeNoteSha256 = sourceChangeNoteSha256;
version.mathScriptSha256 = mathScriptSha256;
version.mathReportSha256 = mathReportSha256;
version.mathStatus = report.status;
version.sourceMathStatus = report.status;
version.apiCalls = 0;
version.businessWrites = 0;
version.noBusinessWrites = true;
writeJson(versionFile, version);

const hashSummary = readJson(hashFile);
hashSummary.artifactHashes = {
  ...(hashSummary.artifactHashes || {}),
  candidateSha256, planSha256, sourceValuesSha256, sourceScopeSha256, sourceChangeNoteSha256, mathScriptSha256, mathReportSha256,
};
hashSummary.outputs = {
  ...(hashSummary.outputs || {}),
  candidateSha256, planSha256, sourceValuesSha256, sourceScopeSha256, sourceChangeNoteSha256, mathScriptSha256, mathReportSha256,
};
hashSummary.math = { script: "独立数学核算.mjs", report: "独立数学报告.json", status: report.status, reportSha256: mathReportSha256 };
hashSummary.apiCalls = 0;
hashSummary.businessWrites = 0;
writeJson(hashFile, hashSummary);

const freeze = readJson(freezeFile);
freeze.status = "修订一候选、数学核算和源值已冻结；未调用业务接口";
freeze.candidateSha256 = candidateSha256;
freeze.planSha256 = planSha256;
freeze.sourceValuesSha256 = sourceValuesSha256;
freeze.sourceScopeSha256 = sourceScopeSha256;
freeze.sourceChangeNoteSha256 = sourceChangeNoteSha256;
freeze.mathReportSha256 = mathReportSha256;
freeze.mathStatus = report.status;
freeze.apiCalls = 0;
freeze.businessWrites = 0;
writeJson(freezeFile, freeze);

const excluded = new Set(["文件散列.json"]);
const files = fs.readdirSync(here).filter(name => !excluded.has(name)).sort((a, b) => a.localeCompare(b, "zh-Hans"));
const manifest = {
  generatedAt: new Date().toISOString(),
  batch: "英雄机制第四十六批",
  revision: version.revision,
  algorithm: "SHA-256",
  basis: "按文件原始字节计算；不含本散列文件",
  files: files.map(file => ({ file, bytes: bytes(path.join(here, file)).length, sha256: sha(path.join(here, file)) })),
};
writeJson(path.join(here, "文件散列.json"), manifest);
console.log(JSON.stringify({ status: report.status, candidateSha256, planSha256, sourceValuesSha256, sourceScopeSha256, sourceChangeNoteSha256, mathScriptSha256, mathReportSha256, manifestFiles: files.length, apiCalls: 0, businessWrites: 0 }, null, 2));
