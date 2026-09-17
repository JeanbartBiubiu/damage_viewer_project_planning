import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, "..", "..", "..");
const DURABLE = path.join(REPO, "数据参考", "全量录入-2026-09", "交叉试录", "Luna", "英雄机制第四十九批");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha(fs.readFileSync(file));
const candidate = readJson(path.join(ROOT, "完整候选.json"));
const plan = readJson(path.join(ROOT, "请求计划.json"));
const sourceValues = readJson(path.join(ROOT, "来源值与计算树.json"));
const sourceScope = readJson(path.join(ROOT, "来源与范围核对.json"));
const mathReport = readJson(path.join(ROOT, "独立数学报告.json"));
const generatedAt = new Date().toISOString();
const candidateSha256 = shaFile(path.join(ROOT, "完整候选.json"));
const planSha256 = shaFile(path.join(ROOT, "请求计划.json"));
const sourceValuesSha256 = shaFile(path.join(ROOT, "来源值与计算树.json"));
const sourceScopeSha256 = shaFile(path.join(ROOT, "来源与范围核对.json"));
const mathSha256 = shaFile(path.join(ROOT, "独立数学报告.json"));
const versionFile = path.join(ROOT, "候选版本.json");
const version = readJson(versionFile);
Object.assign(version, {
  finalizedAt: generatedAt,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  sourceMath: "独立数学核算.mjs",
  sourceMathReport: "独立数学报告.json",
  sourceMathReportSha256: mathSha256,
  sourceMathStatus: mathReport.status,
  math: {
    formulaScenarios: mathReport.formulaScenarios,
    sourceMatches: mathReport.sourceMatches,
    missingRuntimeRejected: mathReport.missingRuntimeRejected,
    failures: mathReport.failures.length,
    tolerance: mathReport.tolerance,
  },
  status: "候选已生成，独立数学已通过，等待主负责人保存；未调用业务接口",
});
writeJson(versionFile, version);
const summaryFile = path.join(ROOT, "来源哈希汇总.json");
const summary = readJson(summaryFile);
Object.assign(summary, {
  finalizedAt: generatedAt,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  mathReportSha256: mathSha256,
  mathStatus: mathReport.status,
});
writeJson(summaryFile, summary);
const indexFile = path.join(ROOT, "候选登记.json");
const index = readJson(indexFile);
Object.assign(index, {
  finalizedAt: generatedAt,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  mathReportSha256: mathSha256,
  mathStatus: mathReport.status,
  status: "候选已生成，独立数学已通过，等待主负责人保存；未调用业务接口",
});
writeJson(indexFile, index);
const registration = [
  "# 第四十九批候选登记",
  "",
  "本目录是纳尔、克烈、奎因、雷克塞20个技能槽的静态候选。候选状态为等待主负责人保存，业务接口、数据库、页面和战斗运行均未调用。",
  "",
  "独立数学核算已通过：60个公式场景、60个原始来源匹配、10个缺少运行输入拒绝，失败0。检查还覆盖二元运算、参数与公式类型引用、技能等级数组、有限数值、整数毫秒、属性存在性、比例属性乘区和效果最终倍率。",
  "",
  "Cursor来源复核为READY（2946事件、79个唯一工具、24项冻结输入），只代表来源审查完成，不代表本候选已保存。",
  "",
  "候选散列：" + candidateSha256,
  "",
  "请求计划散列：" + planSha256,
  "",
  "来源值散列：" + sourceValuesSha256,
  "",
  "范围清单散列：" + sourceScopeSha256,
  "",
  "数学报告散列：" + mathSha256,
  "",
  "新增参数/公式/效果：" + candidate.counts.newParameters + "/" + candidate.counts.newFormulas + "/" + candidate.counts.newEffects + "；公共参数只读复用：" + candidate.counts.reusedPublicParameters + "。",
].join("\n") + "\n";
fs.writeFileSync(path.join(ROOT, "候选登记.md"), registration, "utf8");
const manifest = {
  generatedAt,
  batch: candidate.meta.batch,
  revision: candidate.meta.revision,
  status: "候选已生成，独立数学已通过，等待主负责人保存；未调用业务接口",
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  mathReportSha256: mathSha256,
  files: {},
  note: "按文件字节计算；本清单自身不列入files，避免自引用。",
};
const entries = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name !== "文件散列.json")
  .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
for (const entry of entries) {
  const file = path.join(ROOT, entry.name);
  manifest.files[entry.name] = { sha256: shaFile(file), byteSize: fs.statSync(file).size };
}
writeJson(path.join(ROOT, "文件散列.json"), manifest);
fs.mkdirSync(DURABLE, { recursive: true });
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  fs.copyFileSync(path.join(ROOT, entry.name), path.join(DURABLE, entry.name));
}
const durableFiles = fs.readdirSync(DURABLE, { withFileTypes: true }).filter(entry => entry.isFile());
for (const entry of durableFiles) {
  const source = path.join(ROOT, entry.name);
  const target = path.join(DURABLE, entry.name);
  if (fs.existsSync(source)) {
    if (shaFile(source) !== shaFile(target)) throw new Error("持久目录字节不一致：" + entry.name);
  }
}
if (shaFile(path.join(ROOT, "文件散列.json")) !== shaFile(path.join(DURABLE, "文件散列.json"))) throw new Error("持久目录散列清单不一致");
console.log(JSON.stringify({
  status: mathReport.status,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceScopeSha256,
  mathReportSha256: mathSha256,
  files: Object.keys(manifest.files).length,
  durable: DURABLE,
  apiCalls: candidate.meta.apiCalls,
  businessWrites: candidate.meta.businessWrites,
}, null, 2));
