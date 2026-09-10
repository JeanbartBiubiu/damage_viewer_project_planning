import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(HERE, "..");
const SOURCE = path.resolve(HERE, "..", "..", "hero42-root-entry-20260910");
const BASE_CANDIDATE_FILE = path.join(BASE, "完整候选.json");
const BASE_PLAN_FILE = path.join(BASE, "请求计划.json");
const OUT_CANDIDATE_FILE = path.join(HERE, "完整候选.json");
const OUT_PLAN_FILE = path.join(HERE, "写前请求计划.json");
const OUT_VERSION_FILE = path.join(HERE, "候选版本.json");
const OUT_NOTE_FILE = path.join(HERE, "修订说明.md");
const REVISION = "hero42-source-v1-revision-1";
const BATCH = "英雄机制第四十二批";

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const shaBytes = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const shaFile = file => shaBytes(fs.readFileSync(file));
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const baseCandidateSha256 = shaFile(BASE_CANDIDATE_FILE);
const basePlanSha256 = shaFile(BASE_PLAN_FILE);
assert(baseCandidateSha256 === "885fceded0a863272cd34814145a13e3d482e61e904a4818b259c942db1d9bfa", `原候选散列变化：${baseCandidateSha256}`);
assert(basePlanSha256 === "b20ac9a412caeb046cada9e3ccace07bc81d4e705f7464dba0118f52055854fd", `原请求计划散列变化：${basePlanSha256}`);

const base = readJson(BASE_CANDIDATE_FILE);
const basePlan = readJson(BASE_PLAN_FILE);
const binding = readJson(path.join(SOURCE, "来源绑定与当前文本.json"));
const rawSkill = (heroId, slot) => binding.heroes.find(hero => hero.id === heroId)?.skills.find(skill => skill.slot === slot)?.object.mSpell;
const rawData = (heroId, slot, name, index = 0) => {
  const row = (rawSkill(heroId, slot)?.DataValues || []).find(value => value.name === name);
  assert(row && Array.isArray(row.values) && row.values[index] !== undefined, `缺少来源数据 ${heroId}/${slot}/${name}/${index}`);
  return row.values[index];
};
const rawCoefficient = (heroId, slot, calculation, index = 1) => {
  const part = rawSkill(heroId, slot)?.mSpellCalculations?.[calculation]?.mFormulaParts?.[index];
  assert(part && typeof part.mCoefficient === "number", `缺少来源系数 ${heroId}/${slot}/${calculation}/${index}`);
  return part.mCoefficient;
};
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ADD = (left, right) => O("ADD", left, right);
const MUL = (left, right) => O("MULTIPLY", left, right);
const AP = () => A("SOURCE", "ability_power", "TOTAL");
const parameter = (skill, key) => skill.write.parameters.find(item => item.parameterKey === key);
const formula = (skill, key) => skill.write.formulas.find(item => item.formulaKey === key);
const addParameter = (skill, item) => {
  assert(!parameter(skill, item.parameterKey), `修订参数已存在：${skill.skillKey}/${item.parameterKey}`);
  skill.write.parameters.push(item);
  skill.write.parameters.sort((left, right) => left.sortOrder - right.sortOrder);
};
const addFormula = (skill, item) => {
  assert(!formula(skill, item.formulaKey), `修订公式已存在：${skill.skillKey}/${item.formulaKey}`);
  skill.write.formulas.push(item);
  skill.write.formulas.sort((left, right) => left.sortOrder - right.sortOrder);
};

const revision = clone(base);
const generatedAt = new Date().toISOString();
revision.meta = {
  ...revision.meta,
  generatedAt,
  revision: REVISION,
  status: "修订一候选冻结，待独立数学核对；未调用业务接口",
  baseCandidateSha256,
  baseRequestPlanSha256: basePlanSha256,
  revisionReason: "修复梅尔W法强系数，拆出物理来源反射转换公式，内联芸阿娜P比例，补充奎桑提R首段公式；不新增效果、事件或公式引用节点。",
  apiCalls: 0,
  businessWrites: 0,
  noBusinessWrites: true,
};
revision.revision = REVISION;

const melW = revision.skills.mel_w;
const melWApRatio = rawCoefficient("Mel", "W", "DamagePercent", 1);
const melWPhysReduction = rawData("Mel", "W", "PhysDamageMod", 0);
const melWPhysMultiplier = 1 - melWPhysReduction;
addParameter(melW, {
  parameterKey: "reflected_damage_ap_ratio",
  name: "反射原伤害法强倍率",
  valueType: "DECIMAL",
  valueMode: "FIXED",
  fixedValue: melWApRatio,
  levelValues: null,
  description: "DamagePercent第二项来源系数0.0005，读取来源总法强；与等级反射比例相加。",
  sortOrder: 75,
});
addParameter(melW, {
  parameterKey: "physical_to_magic_multiplier",
  name: "物理来源反射转换倍率",
  valueType: "DECIMAL",
  valueMode: "FIXED",
  fixedValue: melWPhysMultiplier,
  levelValues: null,
  description: "完整反射树×(1-PhysDamageMod)=×(1-30%)=×70%；只供物理来源第二公式，来源类型条件待接线。",
  sortOrder: 90,
});
const reflectedTree = () => MUL(
  ADD(P("reflected_damage_ratio"), MUL(P("reflected_damage_ap_ratio"), AP())),
  P("actual_reflected_source_damage"),
);
const reflectedMagic = formula(melW, "reflected_magic_damage");
assert(reflectedMagic, "缺少梅尔W原公式");
reflectedMagic.expression = reflectedTree();
reflectedMagic.description = "非物理来源反射： (DamagePercent+0.0005×来源总法强)×原施法者调整前实际伤害；不含物理转魔法30%减伤，来源类型条件待接线。";
addFormula(melW, {
  formulaKey: "reflected_physical_magic_damage",
  name: "物理来源反射魔法伤害",
  expression: MUL(reflectedTree(), P("physical_to_magic_multiplier")),
  description: "完整反射树×(1-30%)；仅物理来源分支使用，来源类型条件待接线。",
  sortOrder: 30,
});

const yunaraP = revision.skills.yunara_p;
const yunaraPCritical = formula(yunaraP, "critical_extra_magic_damage");
assert(yunaraPCritical, "缺少芸阿娜P暴击额外伤害公式");
yunaraPCritical.expression = MUL(
  ADD(P("critical_extra_damage_base_ratio"), MUL(P("critical_extra_damage_ap_ratio"), AP())),
  P("actual_critical_damage_base"),
);
yunaraPCritical.description = "内联(0.1+0.001×来源总法强)×独立暴击伤害基准；仅使用运算、参数和属性节点，事件待接线。";

const ksanteR = revision.skills.ksante_r;
const ksanteRSlam = formula(ksanteR, "slam_down_physical_damage");
assert(ksanteRSlam, "缺少奎桑提R第二段公式");
ksanteRSlam.sortOrder = 20;
addFormula(ksanteR, {
  formulaKey: "initial_physical_damage",
  name: "变形前首次物理伤害",
  expression: P("initial_damage"),
  description: "变形前首次击退只消费initial_damage参数；本公式不含完整变形链。",
  sortOrder: 10,
});

const writeKinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const countWrites = kind => revision.order.reduce((count, key) => count + revision.skills[key].write[kind].length, 0);
const writeCounts = Object.fromEntries(writeKinds.map(kind => [kind, countWrites(kind)]));
assert(writeCounts.parameters === 147, `修订参数计数异常：${writeCounts.parameters}`);
assert(writeCounts.formulas === 35, `修订公式计数异常：${writeCounts.formulas}`);
assert(writeCounts.effects === 0 && writeCounts.processes === 0 && writeCounts.internalStates === 0 && writeCounts.triggerRules === 0, "修订不应新增效果、过程、内部状态或触发规则");
const newTotal = writeCounts.parameters + writeCounts.formulas + writeCounts.effects + writeCounts.processes + writeCounts.internalStates + writeCounts.triggerRules;
revision.counts = {
  newParameters: writeCounts.parameters,
  newFormulas: writeCounts.formulas,
  newEffects: writeCounts.effects,
  newProcesses: writeCounts.processes,
  newInternalStates: writeCounts.internalStates,
  newTriggerRules: writeCounts.triggerRules,
  newTotal,
  reusedPublicParameters: base.counts.reusedPublicParameters,
  plannedTotalIncludingReused: newTotal + base.counts.reusedPublicParameters,
  protectedCurrentCompositionLists: base.counts.protectedCurrentCompositionLists,
};

const candidateBytes = jsonBytes(revision);
const candidateSha256 = shaBytes(candidateBytes);
fs.writeFileSync(OUT_CANDIDATE_FILE, candidateBytes, { flag: "w" });

const routeKind = kind => ({ internalStates: "internal-states", triggerRules: "trigger-rules" }[kind] || kind);
const stableKey = body => body.parameterKey ?? body.formulaKey ?? body.effectKey ?? body.processKey ?? body.stateKey ?? body.ruleKey;
const requests = revision.order.flatMap(skillKey => writeKinds.flatMap(kind => revision.skills[skillKey].write[kind].map(body => {
  const route = `/skills/${skillKey}/${routeKind(kind)}`;
  const key = stableKey(body);
  return {
    sequence: 0,
    operation: "POST",
    method: "POST",
    route,
    detailRoute: `${route}/${key}`,
    skillKey,
    kind,
    stableKey: key,
    status: "仅意图，未调用",
    body: clone(body),
  };
})));
requests.forEach((request, index) => { request.sequence = index + 1; });
assert(requests.length === newTotal, `请求数量与新增组成不一致：${requests.length}/${newTotal}`);
const requestPlan = {
  ...basePlan,
  generatedAt,
  status: "修订一仅写入意图，未调用业务接口",
  revision: REVISION,
  baseCandidateSha256,
  baseRequestPlanSha256: basePlanSha256,
  candidateSha256,
  requestCount: requests.length,
  counts: revision.counts,
  noApiCalls: true,
  apiWrites: 0,
  businessWrites: 0,
  requests,
};
const requestBytes = jsonBytes(requestPlan);
const requestPlanSha256 = shaBytes(requestBytes);
fs.writeFileSync(OUT_PLAN_FILE, requestBytes, { flag: "w" });

const version = {
  generatedAt,
  batch: BATCH,
  revision: REVISION,
  status: "修订一候选冻结，待独立数学核对；未调用业务接口",
  clientVersion: revision.meta.sourceVersion.clientVersion,
  officialVersion: revision.meta.sourceVersion.officialVersion,
  candidateSha256,
  planSha256: requestPlanSha256,
  baseCandidateSha256,
  basePlanSha256,
  sourceBindingSha256: basePlan.sourceBindingSha256,
  sourceRangeSha256: basePlan.sourceRangeSha256,
  sourceAuditSha256: basePlan.sourceAuditSha256,
  protectionSnapshotSha256: basePlan.protectionSnapshotSha256,
  publicReuseSha256: basePlan.publicReuseSha256,
  counts: revision.counts,
  requestCount: requests.length,
  apiCalls: 0,
  apiWrites: 0,
  businessWrites: 0,
  noBusinessWrites: true,
  independentMathSha256: null,
};
fs.writeFileSync(OUT_VERSION_FILE, jsonBytes(version), { flag: "w" });

const note = `# 第42批候选修订一

本目录基于冻结候选「${baseCandidateSha256}」与冻结请求计划「${basePlanSha256}」生成。原候选、原请求计划和原独立数学验收目录保持不变。

修订内容：

- 梅尔W新增来源树第二项法强系数「+0.0005×来源总法强」，修复原反射弹体魔法伤害公式。
- 梅尔W新增物理来源反射公式，完整反射树乘以「1-30%=70%」；原公式明确只表示非物理来源。来源类型条件仍待事件接线。
- 芸阿娜P将额外暴击伤害比例内联到实际运算树，只使用运算、参数和属性节点，不用参数伪装公式引用。
- 奎桑提R新增「initial_physical_damage」单参数公式，保留首次击退与穿墙后第二段的两段消费。

修订计数为新增参数147、公式35、效果0、过程0、内部状态0、触发规则0，新增组成182；公共参数复用31，计划总数213。梅尔P未学R索引0的基础50和每层2保持原值。

候选与请求计划均为预写材料，未调用业务接口、未写入业务数据；数学核对结果以本目录独立数学验收报告为准。
`;
fs.writeFileSync(OUT_NOTE_FILE, note, { flag: "w" });

console.log(JSON.stringify({ revision: REVISION, candidateSha256, requestPlanSha256, counts: revision.counts, requestCount: requests.length, apiCalls: 0, apiWrites: 0, businessWrites: 0 }, null, 2));
