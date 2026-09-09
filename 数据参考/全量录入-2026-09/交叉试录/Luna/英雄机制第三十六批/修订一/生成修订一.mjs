import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const revisionDir = path.dirname(fileURLToPath(import.meta.url));
const originalDir = path.resolve(revisionDir, "..");
const durableDir = "C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第三十六批/修订一";
const inputDir = "C:/project/damage_web_dev/.agents/artifacts/hero36-root-entry-20260910";
const generatedAt = new Date().toISOString();
const revision = "hero36-source-v1-revision-1";
const removed = {
  evelynn_w: ["cast_time_ms"],
  evelynn_r: ["cast_time_ms"],
  lillia_q: ["cast_time_ms"],
  lillia_r: ["cast_time_ms"],
  fiddlesticks_e: ["cast_time_ms"],
  fiddlesticks_r: ["cast_time_ms"],
  singed_p: ["cast_time_seconds"],
  singed_q: ["cast_time_seconds"],
  singed_e: ["nonchampion_damage_cap"],
};
const added = {
  evelynn_q: [{
    parameterKey: "marked_bonus_max_hits",
    name: "标记目标最多命中次数",
    valueType: "INTEGER",
    valueMode: "FIXED",
    fixedValue: 3,
    levelValues: null,
    description: "当前正文明确标记目标的下3次攻击或技能可触发标记增伤；这是命中次数上限，不等于憎恨之刺的最多3次重施。",
    sortOrder: 60,
  }],
  evelynn_w: [{
    parameterKey: "charm_charge_time_ms",
    name: "英雄魅惑蓄力时间（毫秒）",
    valueType: "INTEGER",
    valueMode: "FIXED",
    fixedValue: 2500,
    levelValues: null,
    description: "当前正文明确标记持续至少2.5秒后，英雄分支才施加魅惑和魔抗削减；转换为2500毫秒。",
    sortOrder: 70,
  }],
  singed_q: [{
    parameterKey: "mana_per_second",
    name: "剧毒踪迹每秒法力消耗",
    valueType: "INTEGER",
    valueMode: "FIXED",
    fixedValue: 13,
    levelValues: null,
    description: "当前根mana索引0为13，mLocKeys正文明确为每秒法力；仅保存每秒成本，不创建普通一次施放消耗效果。",
    sortOrder: 90,
  }],
};

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const writeBytes = (dir, relative, bytes) => {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: "wx" });
};
const writeTextBoth = (relative, text) => {
  const bytes = Buffer.from(text, "utf8");
  writeBytes(revisionDir, relative, bytes);
  writeBytes(durableDir, relative, bytes);
  return bytes;
};
const writeJsonBoth = (relative, value) => writeTextBoth(relative, JSON.stringify(value, null, 2) + "\n");
const clone = value => JSON.parse(JSON.stringify(value));

fs.mkdirSync(durableDir, { recursive: true });
const candidate = readJson(path.join(originalDir, "完整候选.json"));
const originalPlan = readJson(path.join(originalDir, "请求计划.json"));
const sourceValues = readJson(path.join(originalDir, "来源值摘要.json"));
const sourceRange = readJson(path.join(originalDir, "来源与范围.json"));
const originalVersion = readJson(path.join(originalDir, "候选版本.json"));
const originalHashes = readJson(path.join(originalDir, "来源哈希汇总.json"));

candidate.meta = {
  ...candidate.meta,
  generatedAt,
  revision,
  status: "修订一候选已生成，等待主负责人审查；未调用业务接口",
  candidateSha256: null,
};
candidate.sourceNotes = {
  ...candidate.sourceNotes,
  revision: "修订一删除与mCastTime冲突或无当前施法依据的8项时间参数，删除辛吉德E非英雄封顶；补入伊芙琳Q标记目标最多命中3次、伊芙琳W英雄魅惑蓄力2500毫秒和辛吉德Q每秒13法力。原候选保留在上级目录作为历史证据。",
};
for (const [skillKey, keys] of Object.entries(removed)) {
  const skill = candidate.skills[skillKey];
  if (!skill) throw new Error(`缺少技能：${skillKey}`);
  skill.write.parameters = skill.write.parameters.filter(p => !keys.includes(p.parameterKey));
}
for (const [skillKey, params] of Object.entries(added)) {
  const skill = candidate.skills[skillKey];
  if (!skill) throw new Error(`缺少技能：${skillKey}`);
  for (const parameter of params) {
    if (skill.write.parameters.some(p => p.parameterKey === parameter.parameterKey)) throw new Error(`参数已存在：${skillKey}/${parameter.parameterKey}`);
    skill.write.parameters.push(clone(parameter));
  }
}
for (const skillKey of candidate.order) {
  const skill = candidate.skills[skillKey];
  const parameterKeys = new Set(skill.write.parameters.map(p => p.parameterKey));
  for (const formula of skill.write.formulas) {
    const visit = node => {
      if (!node || typeof node !== "object") return;
      if (node.nodeType === "PARAMETER" && !parameterKeys.has(node.parameterKey)) throw new Error(`公式引用已删除参数：${skillKey}/${node.parameterKey}`);
      if (Array.isArray(node.operands)) node.operands.forEach(visit);
    };
    visit(formula.expression);
  }
}
candidate.counts = {
  ...candidate.counts,
  parameters: Object.values(candidate.skills).reduce((n, s) => n + s.write.parameters.length, 0),
  formulas: Object.values(candidate.skills).reduce((n, s) => n + s.write.formulas.length, 0),
};
candidate.requestCount = candidate.counts.parameters + candidate.counts.formulas + candidate.counts.effects + candidate.counts.processes + candidate.counts.internalStates + candidate.counts.triggerRules;
candidate.meta.sourceRangeSha256 = null;

const range = clone(sourceRange);
range.generatedAt = generatedAt;
range.revision = revision;
range.status = "修订一范围说明；未调用业务接口";
range.revisionChanges = {
  removedParameters: Object.entries(removed).flatMap(([skillKey, keys]) => keys.map(parameterKey => ({ skillKey, parameterKey }))),
  addedParameters: Object.entries(added).flatMap(([skillKey, params]) => params.map(p => ({ skillKey, parameterKey: p.parameterKey, fixedValue: p.fixedValue }))),
  reason: "修正mCastTime与spellCastTime冲突、无独立施法依据的时间字段及一对一范围外的非英雄封顶；补录当前正文明确的触发次数、蓄力窗口和每秒法力成本。",
};
range.counts = clone(candidate.counts);
range.requestCount = candidate.requestCount;
range.publicReuse = candidate.reusedPublicParameters.length;
for (const [skillKey, keys] of Object.entries(removed)) {
  const entry = range.perSkill?.[skillKey];
  if (!entry) continue;
  entry.recordable = (entry.recordable ?? []).filter(key => !keys.includes(key));
  entry.pending ??= [];
  entry.pending.push({ kind: "时序/范围", item: keys.join("、"), reason: keys.includes("nonchampion_damage_cap") ? "本轮唯一敌方英雄范围不保存非英雄封顶参数。" : "与当前mCastTime冲突或缺乏独立施法依据，本修订暂不录入，待时序证据补齐。" });
}
for (const [skillKey, params] of Object.entries(added)) {
  const entry = range.perSkill?.[skillKey];
  if (!entry) continue;
  entry.recordable = [...(entry.recordable ?? []), ...params.map(p => p.parameterKey)];
}
range.noApiCalls = true;
const rangeBytes = Buffer.from(JSON.stringify(range, null, 2) + "\n", "utf8");
const rangeSha = sha256(rangeBytes);
candidate.meta.sourceRangeSha256 = rangeSha;
candidate.meta.candidateSha256 = sha256(JSON.stringify(candidate, null, 2) + "\n");
const candidateBytes = Buffer.from(JSON.stringify(candidate, null, 2) + "\n", "utf8");
const candidateSha = sha256(candidateBytes);
candidate.meta.candidateSha256 = sha256(JSON.stringify({ ...candidate, meta: { ...candidate.meta, candidateSha256: null } }, null, 2) + "\n");
const finalCandidateBytes = Buffer.from(JSON.stringify(candidate, null, 2) + "\n", "utf8");
if (sha256(finalCandidateBytes) !== candidateSha) throw new Error("候选散列计算异常");

const requests = [];
for (const skillKey of candidate.order) {
  const skill = candidate.skills[skillKey].write;
  for (const [kind, identityKey] of [["parameters", "parameterKey"], ["formulas", "formulaKey"], ["effects", "effectKey"], ["processes", "processKey"], ["internalStates", "stateKey"], ["triggerRules", "ruleKey"]]) {
    for (const body of skill[kind]) {
      const stableKey = body[identityKey];
      requests.push({ sequence: requests.length + 1, method: "POST", route: `/skills/${skillKey}/${kind}`, detailRoute: `/skills/${skillKey}/${kind}/${stableKey}`, skillKey, kind, stableKey, status: "仅意图，未调用", body: clone(body) });
    }
  }
}
if (requests.length !== candidate.requestCount) throw new Error(`请求数量不符：${requests.length}/${candidate.requestCount}`);

sourceValues.generatedAt = generatedAt;
sourceValues.revision = revision;
sourceValues.status = "修订一独立冻结源值摘要；未调用业务接口";
for (const skillKey of candidate.order) {
  if (sourceValues.selectedValues?.[skillKey]) sourceValues.selectedValues[skillKey].candidateParameterKeys = candidate.skills[skillKey].write.parameters.map(p => p.parameterKey);
}
const sourceValuesBytes = Buffer.from(JSON.stringify(sourceValues, null, 2) + "\n", "utf8");
const sourceValuesSha = sha256(sourceValuesBytes);
const plan = {
  ...clone(originalPlan),
  generatedAt,
  revision,
  status: "修订一仅写入意图，未调用业务接口",
  candidateSha256: candidateSha,
  sourceRangeSha256: rangeSha,
  requestCount: requests.length,
  counts: clone(candidate.counts),
  requests,
  noApiCalls: true,
  apiWrites: 0,
};
const planBytes = Buffer.from(JSON.stringify(plan, null, 2) + "\n", "utf8");
const planSha = sha256(planBytes);

const version = {
  ...clone(originalVersion),
  generatedAt,
  revision,
  counts: clone(candidate.counts),
  requestCount: requests.length,
  candidateSha256: candidateSha,
  planSha256: planSha,
  sourceValuesSha256: sourceValuesSha,
  sourceRangeSha256: rangeSha,
  strictMath: "独立数学核算.mjs",
  strictMathStatus: "待执行",
  businessWrites: 0,
  apiCalls: 0,
  noApiCalls: true,
  strictMathSha256: null,
  mathScriptSha256: null,
  experienceSha256: null,
  candidateMathReady: false,
  businessMathReady: false,
};
const hashes = {
  ...clone(originalHashes),
  generatedAt,
  revision,
  outputs: {
    candidateSha256: candidateSha,
    planSha256: planSha,
    sourceValuesSha256: sourceValuesSha,
    sourceRangeSha256: rangeSha,
    mathReportSha256: null,
    mathScriptSha256: null,
    experienceSha256: null,
  },
  apiWrites: 0,
};
const diff = {
  generatedAt,
  batch: candidate.meta.batch,
  fromRevision: candidate.meta.revision.replace("-revision-1", ""),
  revision,
  originalCandidateSha256: shaFile(path.join(originalDir, "完整候选.json")),
  originalPlanSha256: shaFile(path.join(originalDir, "请求计划.json")),
  candidateSha256: candidateSha,
  planSha256: planSha,
  counts: { before: clone(readJson(path.join(originalDir, "完整候选.json")).counts), after: clone(candidate.counts) },
  removedParameters: hashes.outputs ? hashes.outputs : undefined,
  changes: {
    removedParameters: Object.entries(removed).flatMap(([skillKey, keys]) => keys.map(parameterKey => ({ skillKey, parameterKey }))),
    addedParameters: Object.entries(added).flatMap(([skillKey, params]) => params.map(p => ({ skillKey, parameterKey: p.parameterKey, fixedValue: p.fixedValue }))),
    formulasUnchanged: true,
    sourceInputUnchanged: true,
    businessWrites: 0,
  },
};
delete diff.removedParameters;

const readme = `# 第三十六批候选修订一

本目录保存原第36批候选的修订一。原候选、原来源摘要和原数学报告仍在上级目录，作为修订前证据；本目录的候选和请求计划才是当前修订版本。输入仍固定客户端16.17、官方16.17.1和当前绑定正文，未调用业务接口。

本修订删除伊芙琳W、R，莉莉娅Q、R，费德提克E、R，辛吉德P、Q中与当前mCastTime冲突或缺少独立施法依据的8个时间参数，并删除辛吉德E的一对一范围外非英雄封顶。补入伊芙琳Q标记目标最多命中3次、伊芙琳W英雄魅惑蓄力2500毫秒和辛吉德Q每秒13法力。公式树保持31条，严格数学结果记录在候选版本和独立数学报告中。

当前仍只保存静态参数与公式意图，不代表业务入库或战斗运行；未知属性阶段、角色等级求值、触发时序和目标资格继续无默认待核。
`;

writeBytes(revisionDir, "完整候选.json", finalCandidateBytes);
writeBytes(durableDir, "完整候选.json", finalCandidateBytes);
writeBytes(revisionDir, "请求计划.json", planBytes);
writeBytes(durableDir, "请求计划.json", planBytes);
writeBytes(revisionDir, "来源值摘要.json", sourceValuesBytes);
writeBytes(durableDir, "来源值摘要.json", sourceValuesBytes);
writeBytes(revisionDir, "来源与范围.json", rangeBytes);
writeBytes(durableDir, "来源与范围.json", rangeBytes);
writeJsonBoth("候选版本.json", version);
writeJsonBoth("来源哈希汇总.json", hashes);
writeJsonBoth("修订差异.json", diff);
writeTextBoth("README.md", readme);
writeBytes(revisionDir, "独立数学核算.mjs", fs.readFileSync(path.join(originalDir, "独立数学核算.mjs")));
writeBytes(durableDir, "独立数学核算.mjs", fs.readFileSync(path.join(originalDir, "独立数学核算.mjs")));
fs.copyFileSync(fileURLToPath(import.meta.url), path.join(durableDir, "生成修订一.mjs"));
console.log(JSON.stringify({ revisionDir, durableDir, candidateSha, planSha, rangeSha, sourceValuesSha, counts: candidate.counts, requestCount: requests.length, removed: diff.changes.removedParameters.length, added: diff.changes.addedParameters.length, apiWrites: 0 }, null, 2));
