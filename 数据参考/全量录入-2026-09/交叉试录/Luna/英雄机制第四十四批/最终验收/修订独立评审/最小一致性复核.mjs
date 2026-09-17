import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(here, "..", "hero44-root-entry-20260910");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const near = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= 1e-6 * Math.max(1, Math.abs(Number(a)), Math.abs(Number(b))) + 1e-7;
const errors = [];
const warnings = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const warn = (condition, message) => { if (!condition) warnings.push(message); };
const candidateFile = path.join(here, "完整候选.json");
const planFile = path.join(here, "写前请求计划.json");
const candidate = readJson(candidateFile);
const plan = readJson(planFile);
const bindingFile = path.join(input, "来源绑定与当前文本.json");
const versionFile = path.join(input, "输入版本.json");
const noteFile = path.join(input, "主负责人源值核对说明.md");
const snapshotFile = path.join(input, "参考资料", "当前20槽保护快照.json");
const reuseFile = path.join(input, "参考资料", "公共参数复用清单.json");
const binding = readJson(bindingFile);
const version = readJson(versionFile);
const snapshot = readJson(snapshotFile);
const reusedList = readJson(reuseFile);
const reusedSet = new Set(reusedList.map(item => `${item.skillKey}/${item.parameterKey}`));
const expectedSkills = [
  "illaoi_p", "illaoi_q", "illaoi_w", "illaoi_e", "illaoi_r",
  "monkeyking_p", "monkeyking_q", "monkeyking_w", "monkeyking_e", "monkeyking_r",
  "neeko_p", "neeko_q", "neeko_w", "neeko_e", "neeko_r",
  "yuumi_p", "yuumi_q", "yuumi_w", "yuumi_e", "yuumi_r",
];
const kinds = ["parameters", "formulas", "effects", "processes", "internalStates", "triggerRules"];
const writeKey = (kind, item) => ({ parameters: item.parameterKey, formulas: item.formulaKey, effects: item.effectKey, processes: item.processKey, internalStates: item.stateKey || item.internalStateKey, triggerRules: item.triggerRuleKey }[kind]);
const skillEntries = key => candidate.skills[key]?.write || {};
const allProtectedSkillKeys = new Set([
  ...expectedSkills,
  ...snapshot.requests.filter(item => /^\/skills\/[^/]+$/.test(item.route)).map(item => item.route.split("/")[2]),
]);

check(candidate.meta?.revision === "hero44-root-revision-2", `修订号不符：${candidate.meta?.revision}`);
check(candidate.meta?.sourceVersion?.clientVersion === "16.17" && candidate.meta?.sourceVersion?.officialVersion === "16.17.1", "来源版本不是固定16.17/16.17.1");
check(JSON.stringify(Object.keys(candidate.skills)) === JSON.stringify(expectedSkills), "20个技能槽或顺序不符");
check(candidate.meta?.sourceBindingSha256 === sha(bindingFile), "候选绑定来源散列与根证据不符");
check(candidate.meta?.sourceInputSha256 === sha(versionFile), "候选输入版本散列与根证据不符");
check(candidate.meta?.principalSourceNoteSha256 === sha(noteFile), "候选主负责人说明散列与根证据不符");
check(candidate.meta?.currentSnapshotSha256 === sha(snapshotFile), "候选保护快照散列与根证据不符");
check(candidate.apiWrites === 0 && candidate.meta?.apiCalls === 0 && candidate.meta?.businessWrites === 0, "候选标记存在业务写入");
check(plan.noApiCalls === true && plan.apiWrites === 0, "请求计划标记存在业务调用");
check(plan.requestCount === plan.requests.length, "请求计划requestCount与实际条目数不一致");
check(plan.requests.every(item => item.method === "POST" && String(item.status).includes("未调用")), "请求计划含非POST或已调用条目");

const candidateKeys = [];
for (const skillKey of expectedSkills) {
  const write = skillEntries(skillKey);
  for (const kind of kinds) {
    check(Array.isArray(write[kind]), `六类载荷缺失：${skillKey}/${kind}`);
    for (const item of write[kind] || []) {
      const stableKey = writeKey(kind, item);
      check(typeof stableKey === "string" && stableKey.length > 0, `载荷缺少稳定键：${skillKey}/${kind}`);
      candidateKeys.push(`${skillKey}|${kind}|${stableKey}`);
    }
  }
}
const planKeys = plan.requests.map(item => `${item.skillKey}|${item.kind}|${item.stableKey}`);
const countBy = list => list.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
const candidateKeyCounts = countBy(candidateKeys);
const planKeyCounts = countBy(planKeys);
check(candidateKeys.length === plan.requests.length, `候选载荷总数${candidateKeys.length}与请求总数${plan.requests.length}不一致`);
for (const [key, count] of candidateKeyCounts) check(planKeyCounts.get(key) === count, `候选载荷没有一一对应请求：${key}`);
for (const [key, count] of planKeyCounts) check(candidateKeyCounts.get(key) === count, `请求存在悬空载荷：${key}`);
check(plan.requests.every(item => item.route === `/skills/${item.skillKey}/${item.kind}` && item.detailRoute === `/skills/${item.skillKey}/${item.kind}/${item.stableKey}`), "请求路由与技能/类别/稳定键不一致");

const parameterSets = new Map(expectedSkills.map(key => [key, new Set((skillEntries(key).parameters || []).map(item => item.parameterKey))]));
const formulaSets = new Map(expectedSkills.map(key => [key, new Set((skillEntries(key).formulas || []).map(item => item.formulaKey))]));
const checkNode = (skillKey, node, location) => {
  if (!node || typeof node !== "object") return;
  if (node.nodeType === "PARAMETER") check(parameterSets.get(skillKey)?.has(node.parameterKey) || reusedSet.has(`${skillKey}/${node.parameterKey}`), `悬空参数引用：${location}/${node.parameterKey}`);
  if (node.nodeType === "FORMULA") check(formulaSets.get(skillKey)?.has(node.formulaKey), `悬空公式引用：${location}/${node.formulaKey}`);
  if (node.nodeType === "OPERATION") {
    check(Array.isArray(node.operands) && node.operands.length === 2, `运算不是双目：${location}`);
    for (const [index, operand] of (node.operands || []).entries()) checkNode(skillKey, operand, `${location}/operands/${index}`);
  }
};
for (const skillKey of expectedSkills) {
  const write = skillEntries(skillKey);
  for (const item of write.formulas || []) checkNode(skillKey, item.expression, `${skillKey}/formulas/${item.formulaKey}`);
  for (const effect of write.effects || []) {
    const base = `${skillKey}/effects/${effect.effectKey}`;
    const duration = effect.lifecycle?.durationValue;
    if (duration?.kind === "PARAMETER") check(parameterSets.get(skillKey)?.has(duration.parameterKey) || reusedSet.has(`${skillKey}/${duration.parameterKey}`), `生命周期参数悬空：${base}/${duration.parameterKey}`);
    for (const result of effect.results || []) {
      const value = result.valueRule?.value;
      if (value?.kind === "PARAMETER") check(parameterSets.get(skillKey)?.has(value.parameterKey) || reusedSet.has(`${skillKey}/${value.parameterKey}`), `效果参数悬空：${base}/${value.parameterKey}`);
      if (value?.kind === "FORMULA") check(formulaSets.get(skillKey)?.has(value.formulaKey), `效果公式悬空：${base}/${value.formulaKey}`);
      const affected = result.detail?.affectedSkillScope?.skillKeys || [];
      for (const affectedSkill of affected) check(allProtectedSkillKeys.has(affectedSkill), `效果目标技能悬空：${base}/${affectedSkill}`);
    }
  }
}

// 修订二删减项必须在写入载荷和请求计划中同时消失。
const emptyWrite = skillKey => kinds.every(kind => (skillEntries(skillKey)[kind] || []).length === 0);
check(emptyWrite("illaoi_e"), "俄洛伊E仍有新增载荷");
check(emptyWrite("neeko_p"), "妮蔻P仍有新增伪装载荷");
check(emptyWrite("yuumi_w"), "悠米W仍有新增附身载荷");
check(!(skillEntries("monkeyking_p").parameters || []).some(item => item.parameterKey === "combat_duration_ms"), "孙悟空P仍有未消费CombatDuration参数");
check(!candidateKeys.some(key => key.startsWith("illaoi_e|") || key.startsWith("neeko_p|") || key.startsWith("yuumi_w|")), "删减技能仍出现在候选请求键");
check(!(skillEntries("yuumi_e").effects || []).some(item => ["self_shield", "self_move_speed"].includes(item.effectKey)), "悠米E仍有未知寿命护盾或移速效果");
check((skillEntries("yuumi_e").formulas || []).some(item => item.formulaKey === "shield_value") && (skillEntries("yuumi_e").formulas || []).some(item => item.formulaKey === "move_speed_ratio"), "悠米E已证数值公式被错误删除");

const rawSpell = (heroId, slot) => binding.heroes.find(hero => hero.id === heroId)?.skills.find(skill => skill.slot === slot)?.object?.mSpell;
const rawData = (heroId, slot, name) => rawSpell(heroId, slot)?.DataValues?.find(item => item.name === name)?.values;
const monkeyEDash = (skillEntries("monkeyking_e").parameters || []).find(item => item.parameterKey === "dash_speed");
check(monkeyEDash?.valueMode === "FIXED" && monkeyEDash.valueType === "INTEGER" && monkeyEDash.fixedValue === 1050, "孙悟空E突进速度未补为1050整数固定值");
check(rawData("MonkeyKing", "E", "DashSpeed")?.[1] === 1050, "根证据孙悟空E DashSpeed不是1050");
const monkeyRRatio = (skillEntries("monkeyking_r").parameters || []).find(item => item.parameterKey === "max_hp_damage_per_second_ratio");
const monkeyRExpected = rawData("MonkeyKing", "R", "BasePercentMaxHPDmgPerSec")?.slice(1, 4) || [];
check(monkeyRRatio?.valueMode === "SKILL_LEVEL" && monkeyRExpected.every((value, index) => near(monkeyRRatio.levelValues?.[String(index + 1)], value)), "孙悟空R4/6/8%数组与根证据不一致");
warn(String(monkeyRRatio?.description || "").includes("0.04/0.06/0.08"), "非阻塞描述问题：孙悟空R实际数组为0.04/0.06/0.08，但参数说明仍写0.02/0.04/0.06。");
const illaoiHeal = (skillEntries("illaoi_p").parameters || []).find(item => item.parameterKey === "missing_hp_heal_ratio");
const illaoiMinEnemy = (skillEntries("illaoi_p").parameters || []).find(item => item.parameterKey === "slam_min_enemy_champions");
const illaoiFormula = (skillEntries("illaoi_p").formulas || []).find(item => item.formulaKey === "self_missing_health_heal");
check(near(illaoiHeal?.fixedValue, rawData("Illaoi", "P", "MissingHPPercentHeal")?.[1]) && near(illaoiHeal?.fixedValue, 0.05), "俄洛伊P治疗比例不是根证据5%");
check(illaoiMinEnemy?.fixedValue === 1 && String(illaoiFormula?.description || "").includes("至少一名敌方英雄"), "俄洛伊P命中资格说明未保留至少一名敌方英雄条件");
check(illaoiFormula?.expression?.nodeType === "OPERATION" && illaoiFormula.expression.operation === "MULTIPLY", "俄洛伊P治疗公式没有按比例乘实际已损失生命");

const integerChecks = [];
for (const skillKey of expectedSkills) for (const item of skillEntries(skillKey).parameters || []) {
  if (item.parameterKey.endsWith("_ms")) {
    const values = item.valueMode === "FIXED" ? [item.fixedValue] : Object.values(item.levelValues || {});
    const passed = values.every(value => Number.isInteger(value) && value >= 0);
    integerChecks.push({ skillKey, parameterKey: item.parameterKey, passed });
    check(passed, `毫秒参数不是非负整数：${skillKey}/${item.parameterKey}`);
  }
  if (item.valueMode === "RUNTIME_INPUT") check(item.fixedValue === null && item.levelValues === null, `运行输入带默认：${skillKey}/${item.parameterKey}`);
}
for (const item of reusedList) {
  const parameter = parameterSets.get(item.skillKey)?.has(item.parameterKey);
  check(!parameter, `公共参数被候选重复新建：${item.skillKey}/${item.parameterKey}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  batch: candidate.meta?.batch,
  revision: candidate.meta?.revision,
  status: errors.length === 0 ? "通过" : "存在正确性阻塞",
  correctnessBlockers: errors,
  nonBlockingFindings: warnings,
  evidence: {
    sourceVersion: candidate.meta?.sourceVersion,
    sourceBindingSha256: sha(bindingFile),
    sourceInputSha256: sha(versionFile),
    principalSourceNoteSha256: sha(noteFile),
    currentSnapshotSha256: sha(snapshotFile),
    sourceReview: candidate.meta?.sourceReview,
  },
  candidateCounts: candidate.counts,
  requestCount: plan.requests.length,
  requestMatchesCandidate: candidateKeys.length === plan.requests.length && errors.filter(item => item.includes("悬空") || item.includes("载荷") || item.includes("请求路由")).length === 0,
  deletedScopeChecks: {
    illaoiEEmpty: emptyWrite("illaoi_e"),
    neekoPEmpty: emptyWrite("neeko_p"),
    yuumiWEmpty: emptyWrite("yuumi_w"),
    monkeyKingPCombatDurationRemoved: !(skillEntries("monkeyking_p").parameters || []).some(item => item.parameterKey === "combat_duration_ms"),
    yuumiEUnknownLifetimeEffectsRemoved: !(skillEntries("yuumi_e").effects || []).some(item => ["self_shield", "self_move_speed"].includes(item.effectKey)),
  },
  focusedSourceChecks: {
    illaoiPHealRatio: { candidate: illaoiHeal?.fixedValue, source: rawData("Illaoi", "P", "MissingHPPercentHeal")?.[1], passed: near(illaoiHeal?.fixedValue, rawData("Illaoi", "P", "MissingHPPercentHeal")?.[1]) },
    monkeyKingEDashSpeed: { candidate: monkeyEDash?.fixedValue, source: rawData("MonkeyKing", "E", "DashSpeed")?.[1], passed: monkeyEDash?.fixedValue === rawData("MonkeyKing", "E", "DashSpeed")?.[1] },
    monkeyKingRPercentRatios: { candidate: monkeyRRatio?.levelValues, source: monkeyRExpected, passed: monkeyRExpected.every((value, index) => near(monkeyRRatio?.levelValues?.[String(index + 1)], value)) },
    illaoiPHitCondition: { minimumEnemyChampions: illaoiMinEnemy?.fixedValue, description: illaoiFormula?.description, passed: illaoiMinEnemy?.fixedValue === 1 && String(illaoiFormula?.description || "").includes("至少一名敌方英雄") },
  },
  structuralChecks: {
    integerMilliseconds: integerChecks,
    binaryOperationRule: "所有候选表达式运算节点均要求恰好两个操作数",
    danglingReferenceErrors: errors.filter(item => item.includes("悬空")),
    publicReuseCount: reusedList.length,
  },
  hashes: {
    copiedCandidate: sha(candidateFile),
    copiedPlan: sha(planFile),
    copiedMathScript: sha(path.join(here, "独立数学核算.mjs")),
    copiedMathReport: sha(path.join(here, "独立数学核算.json")),
  },
  apiWrites: 0,
  noApiCalls: true,
};
fs.writeFileSync(path.join(here, "最小一致性复核报告.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: report.status, blockers: errors.length, nonBlocking: warnings.length, requestCount: plan.requests.length, candidateItems: candidateKeys.length, dangling: report.structuralChecks.danglingReferenceErrors.length }));
if (errors.length) process.exitCode = 1;
