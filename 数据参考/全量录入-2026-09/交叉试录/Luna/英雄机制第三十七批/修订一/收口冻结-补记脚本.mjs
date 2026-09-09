import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(ROOT, file), JSON.stringify(value, null, 2) + "\n", "utf8");
const candidate = read("完整候选.json");
const plan = read("写前请求计划.json");
const math = read("独立源值数学报告.json");
const candidateFileSha256 = hash("完整候选.json");
const planFileSha256 = hash("写前请求计划.json");
if (candidateFileSha256 !== plan.candidateFileSha256) throw new Error("候选与计划散列不一致");
if (math.candidateFileSha256 !== candidateFileSha256) throw new Error("数学报告未对应最终候选");
if (math.status !== "PASS" || math.apiWrites !== 0 || math.apiCalls !== 0) throw new Error("独立数学未通过或存在业务调用记录");

const outputFiles = [
  "完整候选.json",
  "写前请求计划.json",
  "源值解析.json",
  "来源哈希汇总.json",
  "来源与范围.json",
  "候选版本.json",
  "冻结候选锁.json",
  "候选交付索引.json",
  "README.md",
  "体验报告.md",
  "生成候选.mjs",
  "独立源值数学.mjs",
  "独立源值数学报告.json",
  "修订差异.json",
  "收口冻结.mjs",
];

const lock = read("冻结候选锁.json");
lock.finalizedAt = new Date().toISOString();
lock.mathReport = { path: "独立源值数学报告.json", sha256: hash("独立源值数学报告.json"), status: math.status, formulaCaseCount: math.formulaCaseCount, missingInputChecks: math.missingInputChecks, sourceSeriesChecks: math.sourceSeriesChecks, binaryChecks: math.binaryChecks, millisecondTypeChecks: math.millisecondTypeChecks };
lock.candidateFileSha256 = candidateFileSha256;
lock.planFileSha256 = planFileSha256;
lock.apiWrites = 0;
lock.noApiCalls = true;
write("冻结候选锁.json", lock);

const index = read("候选交付索引.json");
index.finalizedAt = new Date().toISOString();
index.files = [...new Set([...index.files, "生成候选.mjs", "修订差异.json", "收口冻结.mjs", "文件散列.json"])];
index.mathReport = { path: "独立源值数学报告.json", sha256: hash("独立源值数学报告.json"), status: math.status };
index.candidateFileSha256 = candidateFileSha256;
index.planFileSha256 = planFileSha256;
index.apiWrites = 0;
write("候选交付索引.json", index);

const version = read("候选版本.json");
version.finalizedAt = new Date().toISOString();
version.candidateFileSha256 = candidateFileSha256;
version.planFileSha256 = planFileSha256;
version.mathReportSha256 = hash("独立源值数学报告.json");
version.apiWrites = 0;
write("候选版本.json", version);

const files = outputFiles.map((file) => ({ path: file, sha256: hash(file), byteSize: fs.statSync(path.join(ROOT, file)).size }));
write("文件散列.json", {
  generatedAt: new Date().toISOString(),
  batch: candidate.meta.batch,
  revision: candidate.revision,
  status: "修订候选静态文件冻结；未调用业务接口",
  files,
  candidateFileSha256,
  planFileSha256,
  mathReportSha256: hash("独立源值数学报告.json"),
  apiWrites: 0,
  apiCalls: 0,
  noApiCalls: true,
});
console.log(JSON.stringify({ candidateFileSha256, planFileSha256, mathReportSha256: hash("独立源值数学报告.json"), manifestFileCount: files.length, manifestSha256: hash("文件散列.json"), apiWrites: 0, apiCalls: 0 }, null, 2));
