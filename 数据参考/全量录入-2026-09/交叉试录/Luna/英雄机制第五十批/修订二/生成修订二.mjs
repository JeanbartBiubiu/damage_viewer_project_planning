import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(ROOT, "..", "修订一");
const INPUT = path.resolve(ROOT, "..", "..", "hero50-root-entry-20260910");
const DURABLE = path.resolve(ROOT, "..", "..", "..", "..", "数据参考", "全量录入-2026-09", "交叉试录", "Luna", "英雄机制第五十批", "修订二");
const REVISION = "hero50-source-v2-luna-revision-2";
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const writeBytes = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const writeJson = (file, value) => writeBytes(file, jsonBytes(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const candidateFile = path.join(ROOT, "完整候选.json");
const planFile = path.join(ROOT, "请求计划.json");
const scopeFile = path.join(ROOT, "来源与范围.json");
const sourceValuesFile = path.join(ROOT, "来源值摘要.json");
const withheldFile = path.join(ROOT, "待补护盾证据.json");
const diffFile = path.join(ROOT, "修订差异.json");
const generatorFile = path.join(ROOT, "生成修订二.mjs");
const finalizerFile = path.join(ROOT, "收尾散列.mjs");

const baseCandidateFile = path.join(BASE, "完整候选.json");
const basePlanFile = path.join(BASE, "请求计划.json");
const baseScopeFile = path.join(BASE, "来源与范围.json");
const baseSourceValuesFile = path.join(BASE, "来源值摘要.json");
const baseCandidate = readJson(baseCandidateFile);
const basePlan = readJson(basePlanFile);
const baseScope = readJson(baseScopeFile);
const baseSourceValues = readJson(baseSourceValuesFile);
const shieldDecisionFile = path.resolve(ROOT, "..", "..", "hero50-final-root-audit", "逐效果护盾决定.json");
const shieldDecision = readJson(shieldDecisionFile);

assert(baseCandidate.revision === "hero50-source-v2-luna-revision-1", "修订一候选版本不是预期冻结版本");
assert(baseCandidate.counts?.newParameters === 120 && baseCandidate.counts?.newFormulas === 24 && baseCandidate.counts?.newEffects === 30 && baseCandidate.counts?.newTotal === 174, "修订一候选计数不是120/24/30/174");
assert(basePlan.requestCount === 174 && basePlan.requests?.length === 174, "修订一请求计划不是174项");
assert(baseCandidate.meta?.candidateSha256 === null, "修订一候选已有非空自引用散列");

const removedSpecs = [
  { skillKey: "udyr_q", effectKey: "standard_on_hit" },
  { skillKey: "udyr_q", effectKey: "standard_max_health_hit" },
  { skillKey: "udyr_q", effectKey: "empowered_max_health_hit" },
  { skillKey: "udyr_r", effectKey: "pulse_damage" },
];
const removedIds = new Set(removedSpecs.map(item => `${item.skillKey}/${item.effectKey}`));
const decisionMap = new Map((shieldDecision.decisions || []).map(item => [`${item.skillKey}/${item.effectKey}`, item]));
const withheldEffects = [];
const candidate = clone(baseCandidate);
candidate.revision = REVISION;
candidate.meta = {
  ...candidate.meta,
  generatedAt: new Date().toISOString(),
  revision: REVISION,
  status: "修订二候选、独立数学与写前计划已冻结；等待主负责人保存，未调用业务接口",
  candidateSha256: null,
  finalizedAt: new Date().toISOString(),
  finalizationNote: "由修订一冻结候选离线生成；初版、修订一、来源输入、其他批次和业务数据均未写入。",
  revisionNotes: [
    ...(candidate.meta.revisionNotes || []),
    "修订二将艾希Q强化攻击结果的spellShieldBlockScope改为null；该决定来自固定本地与公开资料交叉证据。",
    "修订二把乌迪尔Q三项普攻附加结果与R攻击脉冲从正常效果写集合撤出；参数和公式原样保留，四项分别保存待补原因及训练营取证步骤。",
    "26项公共参数是既有120项保护组成的子集；本修订新增170项，包含120参数、24公式、26效果，概念总组成是120+170=290。",
  ],
};
candidate.sourceNotes = {
  ...(candidate.sourceNotes || {}),
  revisionTwo: "修订二不把四项护盾范围未知的Udyr结果猜成null；仅从正常写集合撤出并保留独立待补证据。",
};
candidate.revisionSummary = {
  fromRevision: "hero50-source-v2-luna-revision-1",
  toRevision: REVISION,
  sourceRevisionOne: "仅读取冻结修订一，不覆盖修订一文件。",
  removedFromNormalSaveSet: removedSpecs,
  changedFields: ["/skills/ashe_q/write/effects[effectKey=empowered_attack]/results[resultKey=damage]/spellShieldBlockScope"],
  unchangedComposition: { parameters: 120, formulas: 24 },
  publicReuseIsSubsetOfProtected: true,
  protectedExistingComponents: 120,
  newComponents: 170,
  conceptualAllComponents: 290,
  businessApiCalls: 0,
  databaseWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
};
candidate.apiWrites = 0;
candidate.meta.apiCalls = 0;
candidate.meta.apiWrites = 0;
candidate.meta.businessWrites = 0;

for (const spec of removedSpecs) {
  const skill = candidate.skills?.[spec.skillKey];
  assert(skill?.write && Array.isArray(skill.write.effects), `缺少候选效果集合：${spec.skillKey}`);
  const index = skill.write.effects.findIndex(effect => effect.effectKey === spec.effectKey);
  assert(index >= 0, `修订一缺少待撤出效果：${spec.skillKey}/${spec.effectKey}`);
  const originalEffect = clone(skill.write.effects[index]);
  const decision = decisionMap.get(`${spec.skillKey}/${spec.effectKey}`);
  assert(decision && decision.proven === false && decision.suggestedScope === null, `四项待补护盾决定缺失或已被猜测：${spec.skillKey}/${spec.effectKey}`);
  skill.write.effects.splice(index, 1);
  const formulaKey = originalEffect.results?.[0]?.valueRule?.value?.formulaKey || null;
  withheldEffects.push({
    skillKey: spec.skillKey,
    effectKey: spec.effectKey,
    resultKey: originalEffect.results?.[0]?.resultKey || null,
    normalSaveSet: false,
    originalEffect,
    originalSpellShieldBlockScope: originalEffect.results?.[0]?.spellShieldBlockScope ?? null,
    sourceFormulaKey: formulaKey,
    sourceConclusion: decision.sourceConclusion,
    branchClarification: decision.branchClarification,
    proven: false,
    suggestedScope: null,
    suggestedScopeMeaning: "UNRESOLVED_HOLD：null仅表示本修订不作决定，不是建议写入null。",
    evidenceFilesOrUrls: decision.evidenceFilesOrUrls,
    trainingCampEvidencePlan: decision.minimumSupplement,
    sourceDecisionFile: ".agents/artifacts/hero50-final-root-audit/逐效果护盾决定.json",
    preservedParametersAndFormulas: true,
    pendingReason: "组件和公式已由固定源值证明，但当前结果粒度的法术护盾范围没有逐结果证据；暂不创建正常效果写请求。",
  });
}

const asheQEffect = candidate.skills.ashe_q.write.effects.find(effect => effect.effectKey === "empowered_attack");
const asheQDamage = asheQEffect?.results?.find(result => result.resultKey === "damage");
assert(asheQDamage?.spellShieldBlockScope === "RESULT", "修订一艾希Q强化攻击结果不是预期RESULT，拒绝静默改写");
asheQDamage.spellShieldBlockScope = null;

const counts = {
  ...candidate.counts,
  newParameters: 120,
  newFormulas: 24,
  newEffects: 26,
  newProcesses: 0,
  newInternalStates: 0,
  newTriggerRules: 0,
  newTotal: 170,
  reusedPublicParameters: 26,
  protectedExistingParameters: 79,
  protectedExistingFormulas: 8,
  protectedExistingEffects: 16,
  protectedExistingProcesses: 4,
  protectedExistingTriggerRules: 13,
  protectedCurrentCompositionLists: 120,
  protectedExistingComponents: 120,
  conceptualAllComponents: 290,
  totalComponentsIncludingProtected: 290,
  plannedTotalIncludingReused: 290,
};
candidate.counts = counts;

const scope = clone(baseScope);
scope.revision = REVISION;
scope.generatedAt = new Date().toISOString();
scope.status = "修订二范围与来源证据已同步；四项护盾范围未知结果撤出正常写集合，未调用业务接口";
for (const spec of removedSpecs) {
  const skill = scope.skills?.[spec.skillKey];
  assert(skill && Array.isArray(skill.recordableEffects), `范围缺少效果集合：${spec.skillKey}`);
  skill.recordableEffects = skill.recordableEffects.filter(key => key !== spec.effectKey);
  skill.pending = [
    ...(skill.pending || []),
    `${spec.effectKey}的组件与公式保留在修订二待补证据中，但法术护盾结果范围未逐项证实；暂不进入正常效果写集合。`,
  ];
}
scope.withheldEffects = withheldEffects.map(item => ({
  skillKey: item.skillKey,
  effectKey: item.effectKey,
  resultKey: item.resultKey,
  normalSaveSet: false,
  reason: item.pendingReason,
  trainingCampEvidencePlan: item.trainingCampEvidencePlan,
  sourceDecisionFile: item.sourceDecisionFile,
}));
scope.revisionNotes = [
  ...(scope.revisionNotes || []),
  "修订二艾希Q强化攻击结果spellShieldBlockScope改为null；乌迪尔Q三项结果和R攻击脉冲从recordableEffects移出，公式及参数仍在来源值摘要中保留。",
  "26项公共参数属于既有120项保护组成；正常新增组成计数为120参数、24公式、26效果，共170项；含保护组成的概念总数为290。",
];
scope.noApiCalls = true;
scope.apiWrites = 0;

const sourceValues = clone(baseSourceValues);
sourceValues.revision = REVISION;
sourceValues.generatedAt = new Date().toISOString();
sourceValues.status = "修订二来源值摘要已同步；参数与公式完整保留，四项未知护盾范围效果撤出正常集合";
for (const spec of removedSpecs) {
  const skill = sourceValues.sourceValues?.[spec.skillKey];
  assert(skill && Array.isArray(skill.selectedEffectKeys), `来源值摘要缺少效果选择：${spec.skillKey}`);
  skill.selectedEffectKeys = skill.selectedEffectKeys.filter(key => key !== spec.effectKey);
}
sourceValues.withheldEffects = withheldEffects.map(item => ({
  skillKey: item.skillKey,
  effectKey: item.effectKey,
  resultKey: item.resultKey,
  sourceFormulaKey: item.sourceFormulaKey,
  normalSaveSet: false,
  scopeStatus: "UNRESOLVED_HOLD",
  reason: item.pendingReason,
  trainingCampEvidencePlan: item.trainingCampEvidencePlan,
  originalEffectPreservedIn: "待补护盾证据.json",
}));
sourceValues.revisionNotes = [
  ...(sourceValues.revisionNotes || []),
  "修订二只从selectedEffectKeys撤出四项未知护盾范围效果；相关源文本、原始树、参数和公式选择均保留。",
  "艾希Q强化攻击的护盾范围改为候选结果null，来源值摘要继续只保存源值，不把候选范围字段倒推成源事实。",
];
sourceValues.noApiCalls = true;
sourceValues.apiWrites = 0;

const withheld = {
  schema: "hero50_revision_two_withheld_effects_v1",
  generatedAt: new Date().toISOString(),
  batch: "第五十批乌迪尔阿兹尔艾希伊泽瑞尔",
  revision: REVISION,
  gameVersion: "16.17/16.17.1",
  status: "四项效果仅保留为待补证据，不进入修订二正常请求计划；不把未知范围猜成null。",
  sourceRevisionOne: {
    candidateFile: ".agents/artifacts/hero50-luna-candidate/修订一/完整候选.json",
    candidateSha256: shaFile(baseCandidateFile),
    planFile: ".agents/artifacts/hero50-luna-candidate/修订一/请求计划.json",
    planSha256: shaFile(basePlanFile),
    sourceValuesFile: ".agents/artifacts/hero50-luna-candidate/修订一/来源值摘要.json",
    sourceValuesSha256: shaFile(baseSourceValuesFile),
  },
  effects: withheldEffects,
  trainingCampEvidencePlan: shieldDecision.trainingCampEvidencePlan,
  summary: {
    count: withheldEffects.length,
    allNormalSaveSetFalse: withheldEffects.every(item => item.normalSaveSet === false),
    allUnresolved: withheldEffects.every(item => item.proven === false && item.suggestedScope === null),
    parametersAndFormulasPreserved: true,
    apiCalls: 0,
    databaseWrites: 0,
    browserCalls: 0,
    gitWrites: 0,
  },
};

const diff = {
  schema: "hero50_revision_diff_v2",
  generatedAt: new Date().toISOString(),
  batch: withheld.batch,
  fromRevision: "hero50-source-v2-luna-revision-1",
  toRevision: REVISION,
  sourceRevisionOne: {
    candidateSha256: shaFile(baseCandidateFile),
    planSha256: shaFile(basePlanFile),
    scopeSha256: shaFile(baseScopeFile),
    sourceValuesSha256: shaFile(baseSourceValuesFile),
  },
  changedPaths: [
    {
      file: "完整候选.json",
      path: "/skills/ashe_q/write/effects[effectKey=empowered_attack]/results[resultKey=damage]/spellShieldBlockScope",
      from: "RESULT",
      to: null,
      reason: "固定本地与公开资料交叉证据支持当前聚合结果建议null。",
    },
    ...removedSpecs.map(spec => ({
      file: "完整候选.json",
      path: `/skills/${spec.skillKey}/write/effects[effectKey=${spec.effectKey}]`,
      from: "存在于正常写集合",
      to: "撤出正常写集合，原完整效果保存于待补护盾证据.json",
      reason: "组件和公式已证，结果的法术护盾范围未逐项证实。",
    })),
    ...removedSpecs.map(spec => ({
      file: "来源值摘要.json",
      path: `/sourceValues/${spec.skillKey}/selectedEffectKeys`,
      from: spec.effectKey,
      to: "移除",
      reason: "来源选择与正常写集合保持一致；源文本和rawCalculations仍保留。",
    })),
  ],
  unchanged: {
    parameters: 120,
    formulas: 24,
    formulaKeysPreserved: true,
    parameterKeysPreserved: true,
    noNewProcesses: true,
    noNewInternalStates: true,
    noNewTriggerRules: true,
    noRuntimeCode: true,
  },
  counts: {
    newParameters: 120,
    newFormulas: 24,
    newEffects: 26,
    newTotal: 170,
    withheldEffects: 4,
    protectedExistingComponents: 120,
    reusedPublicParameters: 26,
    conceptualAllComponents: 290,
  },
  removedEffects: removedSpecs.map(spec => ({ skillKey: spec.skillKey, effectKey: spec.effectKey, resultKey: "damage", pendingFile: "待补护盾证据.json" })),
  validation: {
    baseCandidateReadOnly: true,
    basePlanReadOnly: true,
    baseScopeReadOnly: true,
    baseSourceValuesReadOnly: true,
    inputFilesModified: false,
    businessApiCalls: 0,
    databaseWrites: 0,
    browserCalls: 0,
    gitWrites: 0,
  },
};

writeJson(candidateFile, candidate);
writeJson(scopeFile, scope);
writeJson(sourceValuesFile, sourceValues);
writeJson(withheldFile, withheld);
writeJson(diffFile, diff);
for (const name of ["候选版本.json", "来源冻结通知.json"]) writeBytes(path.join(ROOT, name), fs.readFileSync(path.join(BASE, name)));

const plan = clone(basePlan);
plan.generatedAt = new Date().toISOString();
plan.revision = REVISION;
plan.status = "修订二仅写入意图，已同步候选与范围，未调用业务接口";
plan.requests = plan.requests
  .filter(request => !removedIds.has(`${request.skillKey}/${request.stableKey}`) || request.kind !== "effects")
  .map((request, index) => {
    const next = clone(request);
    next.sequence = index + 1;
    if (next.kind === "effects") {
      const effect = candidate.skills[next.skillKey]?.write.effects.find(item => item.effectKey === next.stableKey);
      assert(effect, `请求计划效果在候选中不存在：${next.skillKey}/${next.stableKey}`);
      next.body = clone(effect);
    }
    return next;
  });
assert(plan.requests.length === 170, `修订二请求计划不是170项：${plan.requests.length}`);
plan.requestCount = plan.requests.length;
plan.counts = clone(counts);
plan.candidateSha256 = shaFile(candidateFile);
plan.sourceRangeSha256 = shaFile(scopeFile);
plan.sourceValuesSha256 = shaFile(sourceValuesFile);
plan.noApiCalls = true;
plan.apiWrites = 0;
plan.businessWrites = 0;
plan.revisionSummary = clone(candidate.revisionSummary);
writeJson(planFile, plan);

for (const name of ["完整候选.json", "请求计划.json", "来源与范围.json", "来源值摘要.json", "待补护盾证据.json", "修订差异.json", "候选版本.json", "来源冻结通知.json", "生成修订二.mjs", "收尾散列.mjs"]) {
  const file = path.join(ROOT, name);
  if (fs.existsSync(file)) { fs.mkdirSync(DURABLE, { recursive: true }); fs.copyFileSync(file, path.join(DURABLE, name)); }
}

console.log(JSON.stringify({
  status: "PASS",
  revision: REVISION,
  candidateSha256: shaFile(candidateFile),
  planSha256: shaFile(planFile),
  scopeSha256: shaFile(scopeFile),
  sourceValuesSha256: shaFile(sourceValuesFile),
  withheldFileSha256: shaFile(withheldFile),
  diffFileSha256: shaFile(diffFile),
  counts,
  requestCount: plan.requestCount,
  withheldEffects: withheldEffects.map(item => `${item.skillKey}/${item.effectKey}`),
  durable: DURABLE,
  apiCalls: 0,
  databaseWrites: 0,
  browserCalls: 0,
  gitWrites: 0,
}, null, 2));
