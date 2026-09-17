import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
const files = [
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
  "收口冻结.mjs",
  "输入包散列.txt",
];
const manifest = files.map((file) => ({
  path: file,
  sha256: sha(file),
  byteSize: fs.statSync(path.join(ROOT, file)).size,
}));
const candidateFileSha256 = sha("完整候选.json");
const planFileSha256 = sha("写前请求计划.json");
const mathReportSha256 = sha("独立源值数学报告.json");
fs.writeFileSync(path.join(ROOT, "文件散列.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  batch: "英雄机制第三十五批",
  status: "候选静态文件冻结；未调用业务接口",
  files: manifest,
  candidateFileSha256,
  planFileSha256,
  mathReportSha256,
  apiWrites: 0,
  noApiCalls: true,
}, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  candidateFileSha256,
  planFileSha256,
  mathReportSha256,
  fileCount: files.length,
  apiWrites: 0,
}, null, 2));
