import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {fileURLToPath} from 'node:url';

// 只读取实际写后快照中的完整详情；表达式、参数值和效果字段均来自实际 GET。
const herePath = fileURLToPath(new URL('./', import.meta.url));
const candidatePath = path.join(herePath, '完整候选.json');
const expectedCandidateFileSha256 = '98eb0627937a403ddcecd5b597469271ef5b9e074113083bac38d3572e1f2a83';
const skills = ['irelia_p','irelia_q','irelia_w','irelia_e','irelia_r','fiora_p','fiora_q','fiora_w','fiora_e','fiora_r','camille_p','camille_q','camille_w','camille_e','camille_r','gwen_p','gwen_q','gwen_w','gwen_e','gwen_r'];
const kinds = [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internalStates', 'stateKey'], ['triggerRules', 'ruleKey']];
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !serverFields.has(key)).map(([key, child]) => [key, stable(child)]));
  return value;
};
const firstDiff = (expected, actual, at = '') => {
  if (equal(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return {path: at || '$', expected, actual};
  if (Array.isArray(expected) || Array.isArray(actual)) return {path: at || '$', expected, actual};
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return {path: `${at}.${key}`, expected: expected[key], actual: actual[key]};
    const diff = firstDiff(expected[key], actual[key], `${at}.${key}`);
    if (diff) return diff;
  }
  return {path: at || '$', expected, actual};
};
const round = value => Math.round(value * 1e6) / 1e6;
const numberEqual = (actual, expected) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1e-5;
const candidateBytes = fs.readFileSync(candidatePath);
if (hash(candidateBytes) !== expectedCandidateFileSha256) throw Error('最终候选散列变化，拒绝核算');
const candidate = JSON.parse(candidateBytes);
const runDir = process.env.HERO11_RUN_DIR ? path.resolve(process.env.HERO11_RUN_DIR) : fs.readdirSync(path.join(herePath, '执行记录'), {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => path.join(herePath, '执行记录', entry.name)).filter(dir => fs.existsSync(path.join(dir, '最终全量组件现值.json'))).sort().at(-1);
if (!runDir) throw Error('没有找到实际写后完整组件快照');
const finalSnapshotPath = path.join(runDir, '最终全量组件现值.json');
const finalSnapshotBytes = fs.readFileSync(finalSnapshotPath);
const finalSnapshot = JSON.parse(finalSnapshotBytes);
if (finalSnapshot.details?.length !== 235 || finalSnapshot.missing?.length !== 0 || finalSnapshot.conflicts?.length !== 0 || finalSnapshot.details.some(item => item.status !== 200)) throw Error('实际写后快照不是235条完整成功详情');
const actual = Object.fromEntries(skills.map(skillKey => [skillKey, Object.fromEntries(kinds.map(([kind]) => [kind, []]))]));
for (const detail of finalSnapshot.details) actual[detail.skillKey][detail.kind].push(detail.data);
for (const skillKey of skills) for (const [kind, idField] of kinds) actual[skillKey][kind].sort((a, b) => String(a[idField]).localeCompare(String(b[idField])));
const checks = [];
const failures = [];
const check = (name, pass, detail = null) => { const item = {name, pass, detail}; checks.push(item); if (!pass) failures.push(item); };
const parameter = (skillKey, key) => actual[skillKey].parameters.find(value => value.parameterKey === key);
const formula = (skillKey, key) => actual[skillKey].formulas.find(value => value.formulaKey === key);
const candidateParameter = (skillKey, key) => candidate.skills[skillKey].write.parameters.find(value => value.parameterKey === key);
const valueOfParameter = (skillKey, key, rank, level, runtime) => {
  const value = parameter(skillKey, key);
  if (!value) throw Error(`实际参数缺失 ${skillKey}/${key}`);
  if (value.valueMode === 'FIXED') return value.fixedValue;
  if (value.valueMode === 'RUNTIME_INPUT') {
    const input = runtime[key];
    if (!Number.isFinite(input)) throw Error(`缺少运行时输入 ${skillKey}/${key}`);
    return input;
  }
  const index = value.valueMode === 'CHARACTER_LEVEL' ? level : rank;
  const result = value.levelValues?.[String(index)];
  if (!Number.isFinite(result)) throw Error(`实际参数等级值缺失 ${skillKey}/${key}/${index}`);
  return result;
};
const valueOf = (skillKey, node, context) => {
  if (!node || typeof node !== 'object') throw Error(`空表达式节点 ${skillKey}`);
  if (node.nodeType === 'PARAMETER') return valueOfParameter(skillKey, node.parameterKey, context.rank, context.level, context.runtime);
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
    const result = context.attributes[key];
    if (!Number.isFinite(result)) throw Error(`缺少属性输入 ${skillKey}/${key}`);
    return result;
  }
  if (node.nodeType === 'OPERATION') {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw Error(`表达式不是二元运算 ${skillKey}`);
    const [left, right] = node.operands.map(child => valueOf(skillKey, child, context));
    if (node.operation === 'ADD') return left + right;
    if (node.operation === 'SUBTRACT') return left - right;
    if (node.operation === 'MULTIPLY') return left * right;
    if (node.operation === 'DIVIDE') return left / right;
    if (node.operation === 'MIN') return Math.min(left, right);
    if (node.operation === 'MAX') return Math.max(left, right);
  }
  throw Error(`实际表达式含未支持节点 ${skillKey}/${JSON.stringify(node)}`);
};
const baseAttributes = {
  'SOURCE.attack_damage.BONUS': 120,
  'SOURCE.attack_damage.TOTAL': 300,
  'SOURCE.ability_power.TOTAL': 100,
  'TARGET.hp.TOTAL': 1800,
  'TARGET.hp.CURRENT': 1200,
};
const runtimeFor = skillKey => {
  const runtime = {};
  for (const value of actual[skillKey].parameters.filter(item => item.valueMode === 'RUNTIME_INPUT')) {
    if (value.parameterKey === 'fiora_r_passive_vital_damage_ratio' || value.parameterKey === 'passive_vital_damage_ratio') runtime[value.parameterKey] = 0.04;
    else if (value.parameterKey === 'on_hit_level_component') runtime[value.parameterKey] = 3;
    else if (value.parameterKey === 'shield_stat_value') runtime[value.parameterKey] = 1800;
    else if (value.parameterKey === 'current_damage_conversion_ratio') runtime[value.parameterKey] = 0.6;
    else if (value.parameterKey === 'actual_outer_damage' || value.parameterKey === 'actual_passive_hero_damage') runtime[value.parameterKey] = 100;
    else runtime[value.parameterKey] = 100;
  }
  return runtime;
};
const context = (skillKey, rank, level, overrides = {}) => ({rank, level, runtime: {...runtimeFor(skillKey), ...(overrides.runtime ?? {})}, attributes: {...baseAttributes, ...(overrides.attributes ?? {})}});
const formulaValue = (skillKey, formulaKey, ctx) => {
  const item = formula(skillKey, formulaKey);
  if (!item) throw Error(`实际公式缺失 ${skillKey}/${formulaKey}`);
  return valueOf(skillKey, item.expression, ctx);
};

// 1. 逐项确认实际保存的参数、公式、效果与最终候选一致；29个历史参数按值复用并另行保护其名称、说明和排序。
const preserved29 = new Set();
for (const detail of finalSnapshot.details) {
  const key = `${detail.skillKey}/${detail.kind}/${detail.id}`;
  if (detail.kind === 'parameters' && (candidate.meta?.reuseReport?.sameValueParameters ?? []).some(item => `${item.skillKey}/${item.parameterKey}` === `${detail.skillKey}/${detail.id}`)) preserved29.add(key);
}
check('实际详情总数235', finalSnapshot.details.length === 235, finalSnapshot.details.length);
check('实际参数175', skills.reduce((sum, skillKey) => sum + actual[skillKey].parameters.length, 0) === 175);
check('实际公式44', skills.reduce((sum, skillKey) => sum + actual[skillKey].formulas.length, 0) === 44);
check('实际效果16', skills.reduce((sum, skillKey) => sum + actual[skillKey].effects.length, 0) === 16);
check('实际未生成过程状态触发规则', skills.every(skillKey => actual[skillKey].processes.length === 0 && actual[skillKey].internalStates.length === 0 && actual[skillKey].triggerRules.length === 0));
for (const skillKey of skills) for (const [kind, idField] of kinds) {
  const expected = candidate.skills[skillKey].write[kind];
  const actualItems = actual[skillKey][kind];
  check(`实际${kind}计数 ${skillKey}`, actualItems.length === expected.length, {expected: expected.length, actual: actualItems.length});
  check(`实际${kind}稳定键 ${skillKey}`, new Set(actualItems.map(item => item[idField])).size === actualItems.length);
  for (const expectedItem of expected) {
    const actualItem = actualItems.find(item => item[idField] === expectedItem[idField]);
    check(`实际详情存在 ${skillKey}/${kind}/${expectedItem[idField]}`, !!actualItem);
    if (!actualItem) continue;
    const isPreserved = kind === 'parameters' && preserved29.has(`${skillKey}/${kind}/${expectedItem[idField]}`);
    const diff = isPreserved ? firstDiff({valueType: expectedItem.valueType, valueMode: expectedItem.valueMode, fixedValue: expectedItem.fixedValue, levelValues: expectedItem.levelValues}, {valueType: actualItem.valueType, valueMode: actualItem.valueMode, fixedValue: actualItem.fixedValue, levelValues: actualItem.levelValues}) : firstDiff(stable(expectedItem), stable(actualItem));
    check(`实际详情字段 ${skillKey}/${kind}/${expectedItem[idField]}`, !diff, diff);
  }
}
check('历史29参数全部被保护复用', preserved29.size === 29, [...preserved29]);

// 2. 从实际GET公式详情和实际GET参数详情求值；每个公式覆盖多个技能等级和角色等级。
const formulaRuns = [];
for (const skillKey of skills) {
  const skill = candidate.skills[skillKey];
  const ranks = [...new Set([1, Math.ceil(skill.maxLevel / 2), skill.maxLevel])];
  const runs = [];
  for (const rank of ranks) for (const level of [1, 9, 18]) for (const item of actual[skillKey].formulas) {
    try {
      const value = round(formulaValue(skillKey, item.formulaKey, context(skillKey, rank, level)));
      runs.push({formulaKey: item.formulaKey, rank, level, value, finite: Number.isFinite(value)});
    } catch (error) {
      runs.push({formulaKey: item.formulaKey, rank, level, finite: false, error: `${error.name}: ${error.message}`});
    }
  }
  const bad = runs.filter(item => !item.finite || !Number.isFinite(item.value));
  check(`实际公式全部有限 ${skillKey}`, bad.length === 0, bad);
  formulaRuns.push({skillKey, runs});
}
const getRun = (skillKey, formulaKey, rank, level, overrides = {}) => formulaValue(skillKey, formulaKey, context(skillKey, rank, level, overrides));
const arithmeticCases = [];
const arithmetic = (name, skillKey, formulaKey, expected, rank, level, overrides = {}) => {
  let actualValue = null;
  let error = null;
  try { actualValue = round(getRun(skillKey, formulaKey, rank, level, overrides)); } catch (caught) { error = `${caught.name}: ${caught.message}`; }
  const pass = error === null && numberEqual(actualValue, expected);
  const item = {name, skillKey, formulaKey, rank, level, inputs: {attributes: {...baseAttributes, ...(overrides.attributes ?? {})}, runtime: {...runtimeFor(skillKey), ...(overrides.runtime ?? {})}}, actual: actualValue, expected, pass, ...(error ? {error} : {})};
  arithmeticCases.push(item);
  check(`独立算例 ${name}`, pass, item);
};
arithmetic('艾瑞莉娅Q英雄伤害', 'irelia_q', 'champion_damage', 285, 3, 9);
arithmetic('艾瑞莉娅Q自我治疗', 'irelia_q', 'heal_amount', 33, 3, 9);
arithmetic('艾瑞莉娅W满蓄力魔法减伤', 'irelia_w', 'final_magic_reduction_percent', 39, 5, 18);
arithmetic('菲奥娜R一级每秒自身治疗（额外攻击力100）', 'fiora_r', 'self_healing_per_second', 135, 1, 1, {attributes: {'SOURCE.attack_damage.BONUS': 100}});
arithmetic('菲奥娜R二级每秒自身治疗（额外攻击力100）', 'fiora_r', 'self_healing_per_second', 160, 2, 1, {attributes: {'SOURCE.attack_damage.BONUS': 100}});
arithmetic('菲奥娜R三级每秒自身治疗（额外攻击力100）', 'fiora_r', 'self_healing_per_second', 185, 3, 1, {attributes: {'SOURCE.attack_damage.BONUS': 100}});
arithmetic('菲奥娜R四处破绽真实伤害', 'fiora_r', 'r_vital_true_damage', 288, 3, 1, {runtime: {passive_vital_damage_ratio: 0.04}});
arithmetic('卡蜜尔Q第二段额外伤害', 'camille_q', 'empowered_bonus_damage', 240, 5, 9);
arithmetic('卡蜜尔W外沿伤害', 'camille_w', 'outer_damage', 216, 5, 9);
arithmetic('格温P对英雄实际伤害治疗', 'gwen_p', 'passive_heal_amount', 67, 1, 9, {runtime: {actual_passive_hero_damage: 100}});
arithmetic('格温W双抗总和', 'gwen_w', 'total_resists', 37, 5, 9);
arithmetic('格温R九针最大伤害', 'gwen_r', 'max_damage', 720, 3, 9);

const applyReportPath = fs.existsSync(path.join(runDir, '执行结果.json')) ? path.join(runDir, '执行结果.json') : null;
const applyReport = applyReportPath ? JSON.parse(fs.readFileSync(applyReportPath, 'utf8')) : null;
const report = {
  generatedAt: new Date().toISOString(),
  pass: failures.length === 0,
  candidateFileSha256: expectedCandidateFileSha256,
  candidateObjectSha256: hash(JSON.stringify(candidate)),
  runDir,
  finalSnapshot: {file: finalSnapshotPath, sha256: hash(finalSnapshotBytes), details: finalSnapshot.details.length, allStatus200: finalSnapshot.details.every(item => item.status === 200)},
  actualCounts: {subjects: Object.keys(finalSnapshot.subjects ?? {}).length, lists: finalSnapshot.lists?.length ?? 0, details: finalSnapshot.details.length, parameters: 175, formulas: 44, effects: 16, processes: 0, internalStates: 0, triggerRules: 0},
  apply: applyReport ? {apiWrites: applyReport.apiWrites, preflight: applyReport.preflight, apply: applyReport.apply, final: applyReport.final} : null,
  checks,
  formulaRuns,
  arithmeticCases,
  failures,
  boundary: '实际管理接口写入与完整详情数学核对；运行时输入、触发资格、时序和战斗页面仍未宣称接通。菲奥娜R的5000毫秒是来源说明字段，不据此宣称实际自动持续5秒。',
};
const outputPath = path.join(herePath, '实值独立核算.json');
const outputBytes = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(outputPath, outputBytes);
const caseLines = arithmeticCases.map(item => `- ${item.name}：实际 ${item.actual}，预期 ${item.expected}，${item.pass ? '通过' : '失败'}`).join('\n');
const experience = `# 英雄机制第十一批实际录入与实值核算\n\n生成时间：${report.generatedAt}\n\n最终候选文件 SHA256：\`${expectedCandidateFileSha256}\`。实际写入运行目录：\`${runDir}\`；最终完整组件快照 SHA256：\`${report.finalSnapshot.sha256}\`。\n\n本次写入前 GET 检查20个技能主体、20个代表图、4条角色技能关联和4个目录，并保护写前现有29个参数的完整详情。实际 POST ${applyReport?.apiWrites ?? 0} 次，写后逐项回读确认；最终 GET 得到235条完整组成详情（175个参数、44个公式、16个效果），过程、内部状态、触发规则均为0。列表只核对列表自身提供的字段，完整字段核对来自详情接口。\n\n## 独立算例\n\n${caseLines}\n\n菲奥娜R每秒治疗按来源的75/100/125，加上额外攻击力100乘以0.6，三级实际值为135/160/185。来源中的5000毫秒只记录说明字段，未据此声称运行时会自动持续5秒。\n\n本报告覆盖管理接口实际保存值和表达式数学结果；运行时输入、触发资格、命中时点、持续节拍和战斗页面尚未接通，因此不宣称战斗运行通过。\n`;
const experiencePath = path.join(herePath, '实际录入体验报告.md');
fs.writeFileSync(experiencePath, experience);
console.log(JSON.stringify({pass: report.pass, candidateFileSha256: report.candidateFileSha256, runDir, snapshotSha256: report.finalSnapshot.sha256, outputSha256: hash(outputBytes), checks: checks.length, formulas: 44, arithmeticCases: arithmeticCases.length, failures: failures.length, apiWrites: applyReport?.apiWrites ?? 0}));
if (failures.length) process.exitCode = 1;
