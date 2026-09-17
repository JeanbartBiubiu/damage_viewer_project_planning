import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(ROOT, "..");
const REPO = path.resolve(ROOT, "..", "..", "..", "..");
const DURABLE = path.join(REPO, "数据参考", "全量录入-2026-09", "交叉试录", "Luna", "英雄机制第五十批", "修订一");
const MATH = path.join(ROOT, "独立数学核算.mjs");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const writeJson = (file, value) => fs.writeFileSync(file, jsonBytes(value));
const copy = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(file, path.join(DURABLE, path.basename(file))); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const candidateFile = path.join(ROOT, "完整候选.json");
const planFile = path.join(ROOT, "请求计划.json");
const scopeFile = path.join(ROOT, "来源与范围.json");
const sourceValuesFile = path.join(ROOT, "来源值摘要.json");
const mathReportFile = path.join(ROOT, "独立数学报告.json");
const initialCandidateFile = path.join(BASE, "完整候选.json");
const initialCandidateSha256 = "e9a8310d34c59f81ed621a86a87e25e1d8a964fca8cc6d5de9c6a065eab9df8e";
assert(shaFile(initialCandidateFile) === initialCandidateSha256, "初版候选已发生未授权变化");

const candidate = readJson(candidateFile);
assert(candidate.revision === "hero50-source-v2-luna-revision-1", "修订版本不符");
candidate.meta.finalizedAt = new Date().toISOString();
candidate.meta.status = "修订一候选、独立数学与写前计划已冻结；等待主负责人保存，未调用业务接口";
candidate.meta.finalizationNote = "最终候选仅在修订一目录生成；初版、来源输入、其他批次和业务数据均未写入。";
candidate.meta.candidateSha256 = null;
candidate.apiWrites = 0;
writeJson(candidateFile, candidate);

const plan = readJson(planFile);
plan.revision = candidate.revision;
plan.status = "修订一仅写入意图，已冻结，未调用业务接口";
plan.candidateSha256 = shaFile(candidateFile);
plan.sourceRangeSha256 = shaFile(scopeFile);
plan.requestCount = candidate.counts.newTotal;
plan.counts = candidate.counts;
plan.noApiCalls = true;
plan.apiWrites = 0;
plan.businessWrites = 0;
writeJson(planFile, plan);

// 数学脚本再次从冻结输入和原始计算树读取，随后只更新修订目录及其耐久副本。
execFileSync(process.execPath, [MATH], { cwd: REPO, stdio: "inherit" });
const mathReport = readJson(mathReportFile);
assert(mathReport.status === "PASS" && mathReport.candidateSha256 === shaFile(candidateFile) && mathReport.planSha256 === shaFile(planFile), "数学报告与最终候选或计划散列不一致");

const names = [
  "完整候选.json", "请求计划.json", "来源与范围.json", "来源值摘要.json", "候选版本.json", "来源冻结通知.json",
  "来源哈希汇总.json", "生成候选.mjs", "独立数学核算.mjs", "独立数学报告.json", "体验报告.md", "README.md", "收尾散列.mjs", "文件散列.json",
];
fs.mkdirSync(DURABLE, { recursive: true });
for (const name of names) copy(path.join(ROOT, name));
for (const name of names) {
  const source = path.join(ROOT, name); const target = path.join(DURABLE, name);
  assert(fs.readFileSync(source).equals(fs.readFileSync(target)), `耐久副本字节不一致：${name}`);
}
const manifest = readJson(path.join(ROOT, "文件散列.json"));
for (const [name, detail] of Object.entries(manifest.files || {})) {
  assert(fs.existsSync(path.join(ROOT, name)) && shaFile(path.join(ROOT, name)) === detail.sha256, `文件散列清单不一致：${name}`);
}
console.log(JSON.stringify({
  status: "FINAL",
  candidateSha256: shaFile(candidateFile), planSha256: shaFile(planFile), mathReportSha256: shaFile(mathReportFile),
  counts: candidate.counts, requestCount: plan.requestCount, durable: DURABLE,
  files: Object.fromEntries(names.map(name => [name, { sha256: shaFile(path.join(ROOT, name)), byteSize: fs.statSync(path.join(ROOT, name)).size }])),
  apiCalls: 0, apiWrites: 0, databaseWrites: 0, browserCalls: 0, gitWrites: 0,
}, null, 2));
