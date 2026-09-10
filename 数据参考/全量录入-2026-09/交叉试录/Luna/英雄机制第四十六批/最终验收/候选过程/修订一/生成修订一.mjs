import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(here, "..");
const inputPackage = path.resolve(here, "..", "..", "hero46-root-entry-20260910");
const revision = "hero46-source-v1-luna-revision-1";
const batch = "英雄机制第四十六批";
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const shaFile = file => sha256(fs.readFileSync(file));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const writeBytes = (file, bytes) => fs.writeFileSync(file, bytes);
const writeJson = (file, value) => writeBytes(file, jsonBytes(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const round = value => Number(Number(value).toFixed(9));
const finite = (value, label) => {
  assert(typeof value === "number" && Number.isFinite(value), `固定值必须是有限数字：${label}`);
  return round(value);
};
const toMs = (seconds, label) => {
  const value = Number(seconds) * 1000;
  const rounded = Math.round(value);
  assert(Number.isFinite(value) && Math.abs(value - rounded) < 0.1 && rounded >= 0, `时间无法转为整数毫秒：${label}`);
  return rounded;
};
const P = parameterKey => ({ nodeType: "PARAMETER", parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: "ATTRIBUTE", attributeOwner, attributeKey, attributeValueKind });
const O = (operation, left, right) => ({ nodeType: "OPERATION", operation, operands: [left, right] });
const ref = (kind, key) => kind === "PARAMETER" ? { kind, parameterKey: key } : { kind, formulaKey: key };

const candidateFile = path.join(base, "完整候选.json");
const planFile = path.join(base, "请求计划.json");
const sourceSummaryFile = path.join(base, "来源值摘要.json");
const sourceScopeFile = path.join(base, "来源与范围.json");
const sourceHashFile = path.join(base, "来源哈希汇总.json");
const sourceFreezeFile = path.join(base, "来源冻结通知.json");
const candidateVersionFile = path.join(base, "候选版本.json");
const baseCandidate = readJson(candidateFile);
const basePlan = readJson(planFile);
const baseSourceSummary = readJson(sourceSummaryFile);
const baseScope = readJson(sourceScopeFile);
const baseHashSummary = readJson(sourceHashFile);
const baseVersion = readJson(path.join(base, "候选版本.json"));
const baseFreeze = readJson(path.join(base, "来源冻结通知.json"));
const baseCandidateSha256 = shaFile(candidateFile);
const basePlanSha256 = shaFile(planFile);
const baseSourceValuesSha256 = shaFile(sourceSummaryFile);
const sourceValues = baseSourceSummary.sourceValues;
const generatedAt = new Date().toISOString();
const changes = [];
const addChange = (scope, kind, key, before, after, evidence) => changes.push({ scope, kind, key, before, after, evidence });

const skill = (key, document = baseCandidate) => document.skills[key];
const findParameter = (skillKey, parameterKey, document = baseCandidate) => skill(skillKey, document).write.parameters.find(item => item.parameterKey === parameterKey);
const findFormula = (skillKey, formulaKey, document = baseCandidate) => skill(skillKey, document).write.formulas.find(item => item.formulaKey === formulaKey);
const findEffect = (skillKey, effectKey, document = baseCandidate) => skill(skillKey, document).write.effects.find(item => item.effectKey === effectKey);
const sourceData = (skillKey, name, level = 1) => {
  const values = sourceValues[skillKey]?.rawDataValues?.[name];
  assert(Array.isArray(values) && Number.isFinite(values[level]), `源数组缺少：${skillKey}/${name}/${level}`);
  return values[level];
};
const technique = (skillKey, objectName) => {
  const value = sourceValues[skillKey]?.techniqueSources?.find(item => item.objectName === objectName);
  assert(value, `彗技法源缺少：${skillKey}/${objectName}`);
  return value;
};
const sourceTechniqueData = (skillKey, objectName, name, level = 1) => {
  const values = technique(skillKey, objectName).raw?.dataValues?.[name];
  assert(Array.isArray(values) && Number.isFinite(values[level]), `技法源数组缺少：${skillKey}/${objectName}/${name}/${level}`);
  return values[level];
};
const sourceLevelArray = (skillKey, name, maxLevel = skill(skillKey).maxLevel) => Object.fromEntries(
  Array.from({ length: maxLevel }, (_, index) => [String(index + 1), finite(sourceData(skillKey, name, index + 1), `${skillKey}/${name}/${index + 1}`)]),
);
const replaceParameterKey = (skillKey, from, to) => {
  const target = findParameter(skillKey, from);
  assert(target, `待改参数不存在：${skillKey}/${from}`);
  const before = clone(target);
  target.parameterKey = to;
  for (const formula of skill(skillKey).write.formulas) {
    const text = JSON.stringify(formula.expression);
    if (text.includes(`\"parameterKey\":\"${from}\"`)) {
      const replace = node => {
        if (!node || typeof node !== "object") return;
        if (node.nodeType === "PARAMETER" && node.parameterKey === from) node.parameterKey = to;
        for (const value of Object.values(node)) replace(value);
      };
      replace(formula.expression);
    }
  }
  for (const effect of skill(skillKey).write.effects) {
    const replace = node => {
      if (!node || typeof node !== "object") return;
      if (node.kind === "PARAMETER" && node.parameterKey === from) node.parameterKey = to;
      for (const value of Object.values(node)) replace(value);
    };
    replace(effect);
  }
  return { target, before };
};
const sortWrites = skillKey => {
  const write = skill(skillKey).write;
  for (const kind of ["parameters", "formulas", "effects"]) write[kind].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
};

// 1. 卑尔维斯E减伤是完整五级技能数组，不能保留为固定1级值。
{
  const p = findParameter("belveth_e", "damage_reduction_ratio");
  const before = clone(p);
  p.valueMode = "SKILL_LEVEL";
  p.fixedValue = null;
  p.levelValues = sourceLevelArray("belveth_e", "DRPercent");
  p.description = "技能等级减伤20%/30%/40%/50%/60%，按比例值保存；来源DRPercent索引1至5。";
  addChange("belveth_e", "parameter", "damage_reduction_ratio", before, p, "客户端DataValues.DRPercent[1..5]");
}

// 2. 卑尔维斯W只保留“所在方向具备刷新资格”的范围说明，不写整Q重置效果。
{
  const s = skill("belveth_w");
  const before = clone(s.write.effects);
  s.write.effects = [];
  s.pending = [
    { item: "命中英雄后所在方向的Q刷新资格", reason: "源正文明确刷新该方向资格；当前通用COOLDOWN_CHANGE会重置整个Q，不能代表单一方向，效果留待方向事件层接线。" },
    { item: "mStat省略属性", reason: "保留系数与无默认实际属性，伤害属性口径待运行层核对。" },
  ];
  s.proofNote = "保留W伤害、击飞、减速与mStat系数；只在范围说明中记录命中英雄所在方向的Q刷新资格，不创建整Q重置效果。";
  const scope = baseScope.skills.belveth_w;
  scope.recordableEffects = [];
  scope.pending = clone(s.pending);
  addChange("belveth_w", "effects", "refresh_q_direction", before, [], "根绑定正文有方向资格，但当前效果类型无法表达方向子槽");
}

// 3. 卑尔维斯P四个断点参数是百分数点，和运行层的比例值分开说明。
{
  const entries = [
    ["stack_ratio_level1", "1级每层攻击速度起点（百分数点）", "源ASPerStackLevel1Value=0.1百分数点；这里0.1表示0.1个百分点，不是0.1比例。"],
    ["stack_ratio_initial_per_level", "初始每级每层攻击速度增量（百分数点）", "源ASPerStackInitialBonusPerLevel=0.05百分数点；只记录断点，不补完整曲线。"],
    ["stack_ratio_after_level6", "6级后每级每层攻击速度增量（百分数点）", "源ASPerStackLevel6BonusPerLevel=0.1百分数点；只记录6级断点。"],
    ["stack_ratio_after_level11", "11级后每级每层攻击速度增量（百分数点）", "源ASPerStackLevel11BonusPerLevel=0.15百分数点；只记录11级断点。"],
  ];
  for (const [key, name, description] of entries) {
    const p = findParameter("belveth_p", key);
    const before = clone(p);
    p.name = name;
    p.description = description;
    addChange("belveth_p", "parameter-description", key, before, p, "客户端AttackSpeedPerStack断点DataValues");
  }
  const actual = findParameter("belveth_p", "actual_stack_attack_speed_ratio");
  actual.description = "运行层提供最终实际攻击速度比例（比例值中1表示100%）；上述四个固定断点字段按源值的百分数点单独保存，不直接代替运行值。";
  skill("belveth_p").proofNote = "保留英雄击杀层数、永久层数和3秒自身临时攻速；四个固定断点明确为百分数点，运行层实际值仍无默认，不把断点补成完整等级曲线。";
}

// 4. 洛克Q两层/三层公式显式乘层数，再乘多层整段增强倍率。
{
  const s = skill("locke_q");
  const two = {
    parameterKey: "two_mark_stack_count", name: "两层印记层数", valueType: "INTEGER", valueMode: "FIXED", fixedValue: 2, levelValues: null,
    description: "源正文两层增强包含2层印记；先累计两层单层伤害，再乘20%整段增强。", sortOrder: 145,
  };
  const three = {
    parameterKey: "three_mark_stack_count", name: "三层印记层数", valueType: "INTEGER", valueMode: "FIXED", fixedValue: 3, levelValues: null,
    description: "源正文三层增强包含3层印记；先累计三层单层伤害，再乘40%整段增强。", sortOrder: 155,
  };
  assert(!findParameter("locke_q", two.parameterKey) && !findParameter("locke_q", three.parameterKey), "洛克Q层数参数已存在，拒绝重复添加");
  s.write.parameters.push(two, three);
  const mark = O("ADD", P("mark_damage_base"), O("MULTIPLY", P("mark_ap_ratio"), A("SOURCE", "ability_power", "TOTAL")));
  const f2 = findFormula("locke_q", "two_mark_magic_damage");
  const f3 = findFormula("locke_q", "three_mark_magic_damage");
  const before2 = clone(f2.expression);
  const before3 = clone(f3.expression);
  f2.expression = O("MULTIPLY", P("two_mark_multiplier"), O("MULTIPLY", P("two_mark_stack_count"), mark));
  f2.description = "两层整段=2×(18至50+0.25至0.35×法强)×1.2；2层数和20%增强均来自源值。";
  f3.expression = O("MULTIPLY", P("three_mark_multiplier"), O("MULTIPLY", P("three_mark_stack_count"), mark));
  f3.description = "三层整段=3×(18至50+0.25至0.35×法强)×1.4；3层数和40%增强均来自源值。";
  addChange("locke_q", "formula", "two_mark_magic_damage", before2, f2.expression, "客户端MarkDamage/MarkRatio与TwoMarkBonusPercent=20");
  addChange("locke_q", "formula", "three_mark_magic_damage", before3, f3.expression, "客户端MarkDamage/MarkRatio与ThreeMarkBonusPercent=40");
  baseScope.skills.locke_q.recordableParameters.push(two.parameterKey, three.parameterKey);
  sortWrites("locke_q");
}

// 5. 洛克W自伤读取当前生命；生命周期引用衰减总公式而不是参数。
{
  const f = findFormula("locke_w", "self_damage_per_second");
  const beforeF = clone(f.expression);
  const node = f.expression.operands[1];
  assert(node?.nodeType === "ATTRIBUTE", "洛克W自伤公式结构异常");
  node.attributeValueKind = "CURRENT";
  f.description = "每秒2%当时当前生命；来源HealthCost与SOURCE.hp.CURRENT，运行时逐秒提供生命变化。";
  const e = findEffect("locke_w", "self_move_speed");
  const beforeLife = clone(e.lifecycle.durationValue);
  e.lifecycle.durationValue = ref("FORMULA", "decay_total_time_ms");
  e.description = "自身初始移动速度比例；持续引用DecayTimeHelper对应的衰减总公式1+1秒，不把公式当参数。";
  addChange("locke_w", "formula", "self_damage_per_second", beforeF, f.expression, "源节点为SOURCE.hp.CURRENT");
  addChange("locke_w", "lifecycle", "self_move_speed.durationValue", beforeLife, e.lifecycle.durationValue, "候选公式decay_total_time_ms=DecayTime+TimeMaxPower");
}

// 6. 彗WE效果按每次恢复参数引用，三次总量公式保留为独立数学量。
{
  const e = findEffect("hwei_w", "we_mana_restore");
  const result = e.results[0];
  const before = clone(result.valueRule.value);
  result.valueRule.value = ref("PARAMETER", "we_mana_restore");
  e.name = "宿墨每次回蓝";
  e.description = "每次宿墨命中效果恢复一次法力；三次总量只由独立公式记录，实际时点由事件层接线。";
  result.name = "宿墨每次回蓝";
  result.description = "单次效果引用每次回蓝参数；连续三次分别触发，不把三次总量作为一次效果。";
  addChange("hwei_w", "effect-value", "we_mana_restore", before, result.valueRule.value, "补充对象HweiWE Tooltip_WEOnHitManaRestore每次45至65");
}

// 7. 彗W菜单时间不属于实际技法参数，移除250毫秒菜单参数。
{
  const s = skill("hwei_w");
  const index = s.write.parameters.findIndex(item => item.parameterKey === "w_group_m_cast_time_ms");
  assert(index >= 0, "彗W菜单250毫秒参数不存在");
  const removed = s.write.parameters.splice(index, 1)[0];
  baseScope.skills.hwei_w.recordableParameters = baseScope.skills.hwei_w.recordableParameters.filter(key => key !== removed.parameterKey);
  addChange("hwei_w", "parameter-remove", removed.parameterKey, removed, null, "菜单选择不等于实际施法；Q/W/E技法各自保留源施法时间");
  sortWrites("hwei_w");
}

// 8. 彗EE补入已证的600毫秒延迟，保存为EE技法参数而非组菜单字段。
{
  const s = skill("hwei_e");
  const delayMs = toMs(sourceTechniqueData("hwei_e", "HweiEE", "Delay"), "HweiEE/Delay");
  const p = {
    parameterKey: "ee_delay_ms", name: "双钩血喉命中延迟（毫秒）", valueType: "INTEGER", valueMode: "FIXED", fixedValue: delayMs, levelValues: null,
    description: "补充对象HweiEE的Delay=0.6秒，转为600毫秒；与0.35秒施法时间分开保存。", sortOrder: 175,
  };
  assert(!findParameter("hwei_e", p.parameterKey), "彗EE延迟参数已存在，拒绝重复添加");
  s.write.parameters.push(p);
  baseScope.skills.hwei_e.recordableParameters.push(p.parameterKey);
  addChange("hwei_e", "parameter-add", p.parameterKey, null, p, "彗九种技法来源补充HweiEE.rawDataValues.Delay[1]");
  sortWrites("hwei_e");
}

// 9. 亚恒E只保存spellTotalTime原始字段，不承诺它就是突进耗时。
{
  const renamed = replaceParameterKey("zaahen_e", "dash_stage_duration_ms", "spell_total_time_ms");
  const p = renamed.target;
  const before = renamed.before;
  p.name = "spellTotalTime原始总时间（毫秒）";
  p.description = "源spellTotalTime=0.25秒，转为250毫秒；仅保存原始总时间，不等同突进耗时，spellCastTime=0也不表示突进瞬达。";
  const scope = baseScope.skills.zaahen_e;
  scope.recordableParameters = scope.recordableParameters.map(key => key === "dash_stage_duration_ms" ? "spell_total_time_ms" : key);
  skill("zaahen_e").pending = [
    { item: "突进命中时点和内外圈资格", reason: "保留半径和整段倍率，事件层待接线；spellTotalTime只作为原始总时间字段，不作为突进耗时。" },
  ];
  skill("zaahen_e").proofNote = "外圈物理×1.5与额外最大生命魔法段分开；spellTotalTime原始值单独保存，不把它等同突进耗时。";
  scope.pending = clone(skill("zaahen_e").pending);
  addChange("zaahen_e", "parameter-rename", "spell_total_time_ms", before, p, "客户端fields.spellTotalTime=0.25；spellCastTime=0");
  sortWrites("zaahen_e");
}

// 10. 亚恒P保留倍率公式但移除未经基准证明的直接攻击力效果；凝滞复活仍是本体机制。
{
  const s = skill("zaahen_p");
  const before = clone(s.write.effects);
  s.write.effects = [];
  const scope = baseScope.skills.zaahen_p;
  scope.recordableEffects = [];
  scope.excluded = [
    ...scope.excluded,
    { item: "比例攻击力直接属性效果", reason: "攻击力基准未证，直接写入attribute_flat_add会把比例当固定攻击力值并可能形成自引用；仅保留比例倍率公式。" },
  ];
  s.excluded = [
    ...s.excluded,
    { item: "比例攻击力直接属性效果", reason: "攻击力基准未证，直接效果不成立；保留bonus_ad_ratio_total和full_stack_bonus_ad_ratio公式。" },
  ];
  s.proofNote = "凝滞复活是本体生存机制并保留；比例攻击力只保存无默认实际每层比例与倍率公式，不创建直接攻击力效果，避免属性基准错误和自引用。";
  addChange("zaahen_p", "effects", "bonus_attack_damage", before, [], "根说明要求比例AD不自引用，攻击力基准未证");
}

// 范围说明中的原始修订同步到候选技能记录。
for (const [skillKey, scope] of Object.entries(baseScope.skills)) {
  const s = skill(skillKey);
  if (Array.isArray(scope.recordableParameters)) scope.recordableParameters = [...new Set(scope.recordableParameters)];
  if (Array.isArray(scope.recordableFormulas)) scope.recordableFormulas = [...new Set(scope.recordableFormulas)];
  if (Array.isArray(scope.recordableEffects)) scope.recordableEffects = [...new Set(scope.recordableEffects)];
  if (s.pending) scope.pending = clone(s.pending);
}

const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const counts = Object.fromEntries(kinds.map(kind => [
  kind === "parameters" ? "newParameters" : kind === "formulas" ? "newFormulas" : kind === "effects" ? "newEffects" : kind === "processes" ? "newProcesses" : kind === "internalStates" ? "newInternalStates" : "newTriggerRules",
  Object.values(baseCandidate.skills).reduce((sum, s) => sum + s.write[kind].length, 0),
]));
counts.newTotal = kinds.reduce((sum, kind) => sum + Object.values(baseCandidate.skills).reduce((n, s) => n + s.write[kind].length, 0), 0);
counts.reusedPublicParameters = baseCandidate.reusedPublicParameters.length;
counts.plannedTotalIncludingReused = counts.newTotal + counts.reusedPublicParameters;
counts.protectedCurrentCompositionLists = baseCandidate.counts.protectedCurrentCompositionLists;
baseCandidate.counts = counts;
baseCandidate.meta.scope = "卑尔维斯、彗、洛克、亚恒20个技能槽；一对一保留本体、唯一敌方英雄、自身强化、同敌重复命中和战前层数。卑尔维斯真实形态、虚空鱼、犬狼式自主单位、额外目标和兵野分支按范围排除；亚恒凝滞复活属于本体生存机制并保留。";
baseCandidate.meta.generatedAt = generatedAt;
baseCandidate.meta.revision = revision;
baseCandidate.meta.status = "修订一候选已冻结，等待主负责人保存；未调用业务接口";
baseCandidate.meta.sourceValuesSha256 = null;
baseCandidate.meta.sourceScopeSha256 = null;
baseCandidate.meta.revisionBase = baseCandidateSha256;
baseCandidate.revision = revision;
baseCandidate.sourceNotes = [
  ...baseCandidate.sourceNotes,
  "修订一按主负责人逐槽复核修正：方向资格不写整Q重置、比例属性基准不足时不写直接效果，时间字段保留原始语义。",
  "洛克Q多层公式显式包含2/3层单层贡献；洛克W自伤读取CURRENT生命，生命周期可引用FORMULA。",
];
baseScope.generatedAt = generatedAt;
baseScope.revision = revision;
baseScope.status = "修订一范围和源值说明";
baseScope.counts = clone(counts);
baseScope.revisionChanges = changes.map(change => ({ scope: change.scope, kind: change.kind, key: change.key, evidence: change.evidence }));

// 先写源摘要和范围，使候选元信息指向本修订目录中的字节。
const sourceSummary = clone(baseSourceSummary);
sourceSummary.generatedAt = generatedAt;
sourceSummary.revision = revision;
sourceSummary.status = "修订一源值摘要，未调用业务接口";
sourceSummary.noApiCalls = true;
sourceSummary.apiWrites = 0;
const sourceSummaryBytes = jsonBytes(sourceSummary);
const sourceValuesSha256 = sha256(sourceSummaryBytes);
const sourceScopeBytes = jsonBytes(baseScope);
const sourceScopeSha256 = sha256(sourceScopeBytes);

baseCandidate.meta.sourceValuesSha256 = sourceValuesSha256;
baseCandidate.meta.sourceScopeSha256 = sourceScopeSha256;
const candidateBytes = jsonBytes(baseCandidate);
const candidateSha256 = sha256(candidateBytes);

const plan = clone(basePlan);
plan.generatedAt = generatedAt;
plan.revision = revision;
plan.status = "修订一请求计划，仅意图未调用业务接口";
plan.candidateSha256 = candidateSha256;
plan.sourceBindingSha256 = baseCandidate.meta.sourceBindingSha256;
plan.sourceRangeSha256 = baseCandidate.meta.sourceRangeSha256;
plan.sourceAuditSha256 = baseCandidate.meta.sourceAuditSha256;
plan.protectionSnapshotSha256 = baseCandidate.meta.protectionSnapshotSha256;
plan.publicReuseSha256 = baseCandidate.meta.publicReuseSha256;
plan.counts = clone(counts);
plan.reusedPublicParameters = clone(baseCandidate.reusedPublicParameters);
plan.requests = [];
let sequence = 1;
const routeKind = { internalStates: "internal-states", triggerRules: "trigger-rules" };
for (const skillKey of baseCandidate.order) {
  const s = skill(skillKey);
  for (const kind of kinds) {
    for (const item of s.write[kind]) {
      const stableKey = kind === "parameters" ? item.parameterKey : kind === "formulas" ? item.formulaKey : item.effectKey ?? item.processKey ?? item.internalStateKey ?? item.triggerRuleKey;
      assert(stableKey, `请求稳定键缺失：${skillKey}/${kind}`);
      const route = routeKind[kind] || kind;
      plan.requests.push({
        sequence: sequence++, operation: "POST", method: "POST",
        route: `/skills/${skillKey}/${route}`,
        detailRoute: `/skills/${skillKey}/${route}/${stableKey}`,
        skillKey, kind, stableKey, status: "仅意图，未调用", body: clone(item),
      });
    }
  }
}
plan.requestCount = plan.requests.length;
plan.noApiCalls = true;
plan.apiWrites = 0;
plan.businessWrites = 0;
const planBytes = jsonBytes(plan);
const planSha256 = sha256(planBytes);

const sourceChangeNote = [
  "# 第四十六批修订一来源与范围变更说明",
  "",
  `修订标识：${revision}。源版本固定为客户端16.17、官方16.17.1；源输入和198次GET保护快照沿用初版冻结散列，未执行业务接口。`,
  "",
  "## 已修正项",
  "",
  `1. 卑尔维斯E的DRPercent源数组索引1至5为${sourceLevelArray("belveth_e", "DRPercent")["1"]}/${sourceLevelArray("belveth_e", "DRPercent")["2"]}/${sourceLevelArray("belveth_e", "DRPercent")["3"]}/${sourceLevelArray("belveth_e", "DRPercent")["4"]}/${sourceLevelArray("belveth_e", "DRPercent")["5"]}，候选改为完整五级比例数组。`,
  "2. 卑尔维斯W移除通用COOLDOWN_CHANGE效果，只保留命中英雄所在方向的刷新资格说明，避免把整Q重置误写成单方向刷新。",
  "3. 卑尔维斯P四个固定断点值0.1/0.05/0.1/0.15按百分数点说明；运行层实际攻速比例仍无默认。",
  "4. 洛克Q新增两层、三层计数参数，公式分别为2×单层×1.2和3×单层×1.4；层数和倍率均独立取源。",
  "5. 洛克W自伤公式节点改为SOURCE.hp.CURRENT；自身移速生命周期改引用decay_total_time_ms公式，不再把公式当参数。",
  `6. 彗WE回蓝效果改为每次引用we_mana_restore参数；三次总量公式保留。彗EE补入HweiEE Delay=${toMs(sourceTechniqueData("hwei_e", "HweiEE", "Delay"), "HweiEE/Delay")}毫秒。`,
  "7. 彗W移除菜单250毫秒参数；亚恒E将dash_stage_duration_ms改为spell_total_time_ms，仅保存spellTotalTime原始总时间。",
  "8. 亚恒P移除直接攻击力属性效果，保留比例和满层倍率公式；凝滞复活属于本体生存机制，仍在范围内。",
  "",
  "## 复核边界",
  "",
  "本修订只改变候选、请求计划、源摘要元信息、范围记录和核算脚本；请求计划仍全部为POST意图，未执行保存。数学报告必须独立读取源数组、源计算树和技法补充，增加洛克Q两层/三层及当前生命不等于最大生命的场景。静态候选和数学通过不等于业务接口保存、页面接线或战斗运行通过。",
  "",
  `初版候选散列：${baseCandidateSha256}\n初版请求计划散列：${basePlanSha256}\n初版源摘要散列：${baseSourceValuesSha256}`,
].join("\n");
const sourceChangeNoteBytes = Buffer.from(sourceChangeNote + "\n", "utf8");
const sourceChangeNoteSha256 = sha256(sourceChangeNoteBytes);

const sourceHashSummary = clone(baseHashSummary);
sourceHashSummary.generatedAt = generatedAt;
sourceHashSummary.revision = revision;
sourceHashSummary.inputPackage = ".agents/artifacts/hero46-root-entry-20260910";
sourceHashSummary.originalArtifactHashes = clone(baseHashSummary.artifactHashes || {});
sourceHashSummary.artifactHashes = {
  ...(baseHashSummary.artifactHashes || {}),
  generatedAt, batch, revision,
  candidateSha256, planSha256, sourceValuesSha256, sourceScopeSha256, sourceChangeNoteSha256,
  mathScriptSha256: null, mathReportSha256: null,
};
sourceHashSummary.outputs = {
  candidateSha256, planSha256, sourceValuesSha256, sourceScopeSha256, sourceChangeNoteSha256,
  mathScriptSha256: null, mathReportSha256: null,
};
sourceHashSummary.apiCalls = 0;
sourceHashSummary.businessWrites = 0;

const version = {
  generatedAt, batch, revision,
  status: "修订一候选，未调用业务接口",
  baseRevision: baseVersion.revision,
  baseCandidateSha256, basePlanSha256, baseSourceValuesSha256,
  candidateSha256, planSha256, sourceValuesSha256, sourceScopeSha256, sourceChangeNoteSha256,
  mathScriptSha256: null, mathReportSha256: null, mathStatus: "待执行",
  counts: clone(counts), requestCount: plan.requests.length,
  reusedPublicParameters: baseCandidate.reusedPublicParameters.length,
  sourceReview: clone(baseVersion.sourceReview),
  sourceMath: "独立数学核算.mjs",
  apiCalls: 0, businessWrites: 0, noBusinessWrites: true,
};

const freeze = {
  ...clone(baseFreeze), generatedAt, revision,
  candidateSha256, planSha256, sourceValuesSha256, sourceScopeSha256, sourceChangeNoteSha256,
  counts: clone(counts), requestCount: plan.requests.length,
  sourceReview: clone(baseFreeze.sourceReview), apiCalls: 0, businessWrites: 0,
  status: "修订一候选和源值已冻结，等待主负责人保存；未调用业务接口",
};

const readme = [
  "# 第四十六批候选修订一",
  "",
  "本目录是第46批初版候选的隔离修订，只保存卑尔维斯、彗、洛克、亚恒20个技能槽的静态候选。初版目录保持不变。",
  "",
  "修订覆盖：卑尔维斯E五级减伤、W方向资格说明、P百分数点单位；洛克Q多层计数、W当前生命和公式生命周期；彗WE每次回蓝、W菜单参数、EE延迟；亚恒E原始总时间和P比例攻击力效果。",
  "",
  "来源固定客户端16.17、官方16.17.1；198次GET保护和26个公共参数只读复用。请求计划全部为未执行POST意图。",
  "",
  "独立数学脚本检查源值、两场景公式、缺值拒绝、类型引用、二元运算、等级数组、毫秒整数和效果最终值。静态候选不代表业务保存、页面接线或战斗运行。",
].join("\n") + "\n";
const experience = [
  "# 第四十六批修订一体验记录",
  "",
  "修订一沿用客户端16.17、官方16.17.1、根绑定正文、逐槽说明和彗九种技法补充；Cursor来源复核为READY，3134个事件、63个唯一工具、26个冻结输入，业务写入0，Git零变化。",
  "",
  "候选仍保留20个本体技能槽、唯一敌方英雄和自身增益范围。卑尔维斯真实形态、虚空鱼与吞噬链，纯兵野和额外敌人分支按冻结范围排除；亚恒凝滞复活属于本体生存机制并保留。",
  "",
  "彗九种技法继续放在Q/W/E三组，菜单不生成独立冷却或消耗。彗W宿墨的效果按每次回蓝参数引用，三次总量仅作为公式；EE保存已证600毫秒延迟。",
  "",
  "洛克Q两层与三层公式分别包含2/3层单层贡献和1.2/1.4整段倍率；洛克W自伤读取当前生命，移速生命周期引用衰减总公式。比例属性效果继续使用attribute_flat_add。",
  "",
  "固定值均为有限非零数，未知曲线、属性口径、阶段和事件时点使用无默认运行输入；角色等级数组完整18级，技能等级数组按最大等级保存，毫秒字段为整数。",
  "",
  "本目录仅提供静态候选、请求计划、源值说明、数学核算和体验记录；未执行业务接口、数据库、浏览器或战斗运行。",
].join("\n") + "\n";

const artifacts = {
  "完整候选.json": candidateBytes,
  "请求计划.json": planBytes,
  "来源值摘要.json": sourceSummaryBytes,
  "来源与范围.json": sourceScopeBytes,
  "来源哈希汇总.json": jsonBytes(sourceHashSummary),
  "候选版本.json": jsonBytes(version),
  "来源冻结通知.json": jsonBytes(freeze),
  "来源变更说明.md": sourceChangeNoteBytes,
  "修订差异.json": jsonBytes({ generatedAt, batch, revision, base: { candidateSha256: baseCandidateSha256, planSha256: basePlanSha256, sourceValuesSha256: baseSourceValuesSha256 }, changes, counts, requestCount: plan.requests.length, apiCalls: 0, businessWrites: 0 }),
  "README.md": Buffer.from(readme, "utf8"),
  "体验报告.md": Buffer.from(experience, "utf8"),
};
for (const [name, bytes] of Object.entries(artifacts)) writeBytes(path.join(here, name), bytes);

console.log(JSON.stringify({ batch, revision, counts, requestCount: plan.requests.length, candidateSha256, planSha256, sourceValuesSha256, sourceScopeSha256, sourceChangeNoteSha256, apiCalls: 0, businessWrites: 0 }, null, 2));
