import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, "..", "..", "..", "..");
const DURABLE = path.join(REPO, "数据参考", "全量录入-2026-09", "交叉试录", "Luna", "英雄机制第五十批", "修订二");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const names = [
  "完整候选.json", "请求计划.json", "来源与范围.json", "来源值摘要.json", "待补护盾证据.json", "修订差异.json",
  "候选版本.json", "来源冻结通知.json", "来源哈希汇总.json", "生成修订二.mjs", "独立数学核算.mjs", "独立数学报告.json",
  "体验报告.md", "README.md", "收尾散列.mjs", "文件散列.json",
];
const candidate = readJson(path.join(ROOT, "完整候选.json"));
const plan = readJson(path.join(ROOT, "请求计划.json"));
const math = readJson(path.join(ROOT, "独立数学报告.json"));
const manifest = readJson(path.join(ROOT, "文件散列.json"));
assert(candidate.revision === "hero50-source-v2-luna-revision-2", "候选修订号不符");
assert(candidate.counts.newTotal === 170 && plan.requestCount === 170, "候选或计划不是170项");
assert(math.status === "PASS" && math.formulaChecks.scenarioCount === 48 && math.effectChecks.finalValueCount === 52, "独立数学报告计数不符");
for (const name of names) {
  const source = path.join(ROOT, name);
  const target = path.join(DURABLE, name);
  assert(fs.existsSync(source) && fs.existsSync(target), `缺少最终文件：${name}`);
  assert(fs.readFileSync(source).equals(fs.readFileSync(target)), `耐久副本字节不一致：${name}`);
}
for (const [name, detail] of Object.entries(manifest.files || {})) {
  assert(fs.existsSync(path.join(ROOT, name)) && shaFile(path.join(ROOT, name)) === detail.sha256, `文件散列清单不一致：${name}`);
}
console.log(JSON.stringify({
  status: "FINAL",
  revision: candidate.revision,
  candidateSha256: shaFile(path.join(ROOT, "完整候选.json")),
  planSha256: shaFile(path.join(ROOT, "请求计划.json")),
  mathReportSha256: shaFile(path.join(ROOT, "独立数学报告.json")),
  counts: candidate.counts,
  requestCount: plan.requestCount,
  formulaScenarios: math.formulaChecks.scenarioCount,
  effectFinalValueChecks: math.effectChecks.finalValueCount,
  durable: DURABLE,
  apiCalls: 0,
  databaseWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
}, null, 2));
