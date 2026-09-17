import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = 'C:/project/damage_web_dev';
const candidateDir = path.join(root, '.agents', 'artifacts', 'hero36-luna-candidate', '修订一');
const inputDir = path.join(root, '.agents', 'artifacts', 'hero36-root-entry-20260910');
const reviewDir = path.join(root, '.agents', 'artifacts', 'hero36-independent-review');
const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '写前请求计划.json');
const planAliasPath = path.join(candidateDir, '请求计划.json');
const sourcePath = path.join(inputDir, '来源绑定与当前文本.json');
const diffPath = path.join(candidateDir, '修订差异.json');
const mathPath = path.join(candidateDir, '独立数学核算.mjs');
const reportPath = path.join(reviewDir, '候选审查-修订一.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const aliasPlan = readJson(planAliasPath);
const source = readJson(sourcePath);
const revisionDiff = readJson(diffPath);
const sourceSkills = new Map(source.heroes.flatMap(hero => hero.skills).map(skill => [skill.skillKey, skill]));
const checks = [];
const check = (id, pass, expected, actual, evidence) => checks.push({ id, pass: Boolean(pass), expected, actual, evidence });
const skill = key => candidate.skills[key];
const parameter = (key, parameterKey) => skill(key)?.write?.parameters?.find(item => item.parameterKey === parameterKey);
const formula = (key, formulaKey) => skill(key)?.write?.formulas?.find(item => item.formulaKey === formulaKey);
const rawSpell = key => sourceSkills.get(key)?.object?.mSpell;
const rawData = (key, name) => rawSpell(key)?.DataValues?.find(item => item.name === name)?.values;
const rawCalculation = (key, name) => rawSpell(key)?.mSpellCalculations?.[name];
const walk = (node, callback) => { if (!node || typeof node !== 'object') return; callback(node); for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value, callback); };
const parameterRefs = node => { const result = []; walk(node, item => { if (item.nodeType === 'PARAMETER') result.push(item.parameterKey); }); return result; };
const attributeRefs = node => { const result = []; walk(node, item => { if (item.nodeType === 'ATTRIBUTE') result.push(`${item.attributeOwner}.${item.attributeKey}.${item.attributeValueKind}`); }); return result; };
const binary = node => { let pass = true; walk(node, item => { if (item.nodeType === 'OPERATION' && (!Array.isArray(item.operands) || item.operands.length !== 2)) pass = false; }); return pass; };

check('candidate_sha256', sha(candidatePath) === '9d278c07710b96dc7d29a91df2160ea34954daccb8cf576a0e72492295cf0313', '9d278c07710b96dc7d29a91df2160ea34954daccb8cf576a0e72492295cf0313', sha(candidatePath), '修订一完整候选实际字节');
check('plan_sha256', sha(planPath) === '2241e69a53f9538a4135515251f063aa5df4a03120e33163f56648d5471ec91b' && sha(planAliasPath) === sha(planPath), '写前计划及别名计划均为2241e69a...', { writtenPlan: sha(planPath), aliasPlan: sha(planAliasPath) }, '修订一计划文件实际字节');
check('source_binding', candidate.meta?.sourceBindingSha256 === '9fe03948856d29d6c74d6f01c14a9be81d626dbf0f84d6e8991658ac7e606a13' && source.sourceIndexSha256 === candidate.meta?.sourceIndexSha256, candidate.meta?.sourceBindingSha256, { candidate: candidate.meta?.sourceBindingSha256, sourceIndex: source.sourceIndexSha256 }, '固定来源绑定与来源索引');
check('counts', JSON.stringify(candidate.counts) === JSON.stringify({ skills: 20, parameters: 129, formulas: 31, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 }) && candidate.requestCount === 160 && plan.requestCount === 160 && plan.requests?.length === 160, { parameters: 129, formulas: 31, effects: 0, requestCount: 160 }, { counts: candidate.counts, requestCount: candidate.requestCount, planRequestCount: plan.requestCount, planEntries: plan.requests?.length }, '修订一组成与计划计数');
check('no_business_writes', candidate.meta?.businessWrites === 0 && candidate.meta?.apiCalls === 0 && candidate.meta?.tokenStored === false, true, { businessWrites: candidate.meta?.businessWrites, apiCalls: candidate.meta?.apiCalls, tokenStored: candidate.meta?.tokenStored }, '候选只读状态');

const originalPath = path.join(root, '.agents', 'artifacts', 'hero36-luna-candidate', '完整候选.json');
const original = readJson(originalPath);
const keys = (value, kind, id) => value.order.flatMap(skillKey => (value.skills[skillKey]?.write?.[kind] ?? []).map(item => `${skillKey}/${item[id]}`));
const originalParameters = new Set(keys(original, 'parameters', 'parameterKey'));
const revisedParameters = new Set(keys(candidate, 'parameters', 'parameterKey'));
const expectedRemoved = ['evelynn_w/cast_time_ms', 'evelynn_r/cast_time_ms', 'lillia_q/cast_time_ms', 'lillia_r/cast_time_ms', 'fiddlesticks_e/cast_time_ms', 'fiddlesticks_r/cast_time_ms', 'singed_p/cast_time_seconds', 'singed_q/cast_time_seconds', 'singed_e/nonchampion_damage_cap'];
const expectedAdded = ['evelynn_q/marked_bonus_max_hits', 'evelynn_w/charm_charge_time_ms', 'singed_q/mana_per_second'];
const removed = [...originalParameters].filter(key => !revisedParameters.has(key)).sort();
const added = [...revisedParameters].filter(key => !originalParameters.has(key)).sort();
check('revision_parameter_delta', JSON.stringify(removed) === JSON.stringify(expectedRemoved.sort()) && JSON.stringify(added) === JSON.stringify(expectedAdded.sort()), { removed: expectedRemoved, added: expectedAdded }, { removed, added }, '修订差异只移除9项并增加3项');
check('added_parameter_values', parameter('evelynn_q', 'marked_bonus_max_hits')?.fixedValue === 3 && parameter('evelynn_w', 'charm_charge_time_ms')?.fixedValue === 2500 && parameter('singed_q', 'mana_per_second')?.fixedValue === rawSpell('singed_q')?.mana?.[0] && /每秒/.test(parameter('singed_q', 'mana_per_second')?.description ?? ''), { marked_bonus_max_hits: 3, charm_charge_time_ms: 2500, mana_per_second: 13 }, { marked_bonus_max_hits: parameter('evelynn_q', 'marked_bonus_max_hits'), charm_charge_time_ms: parameter('evelynn_w', 'charm_charge_time_ms'), mana_per_second: parameter('singed_q', 'mana_per_second') }, '三项新增参数与当前正文/原始字段');
check('removed_cap_and_times', !revisedParameters.has('singed_e/nonchampion_damage_cap') && !revisedParameters.has('singed_p/cast_time_seconds') && !revisedParameters.has('singed_q/cast_time_seconds'), true, { singedECap: revisedParameters.has('singed_e/nonchampion_damage_cap'), singedPTiming: revisedParameters.has('singed_p/cast_time_seconds'), singedQTiming: revisedParameters.has('singed_q/cast_time_seconds') }, '移出兵野专用上限和未证通用施法时间');

const mathText = fs.readFileSync(mathPath, 'utf8');
const evaluatorStart = mathText.indexOf('function evaluate');
const expectedStart = mathText.indexOf('function expected');
const formulaLoopStart = mathText.indexOf('const formulaResults =');
const evaluatorText = evaluatorStart >= 0 && expectedStart > evaluatorStart ? mathText.slice(evaluatorStart, expectedStart) : '';
const expectedText = expectedStart >= 0 && formulaLoopStart > expectedStart ? mathText.slice(expectedStart, formulaLoopStart) : '';
check('math_actual_uses_candidate_values', /const candidateParameter\s*=/.test(mathText) && /candidateParameter\(skillKey, node\.parameterKey/.test(evaluatorText) && !/sourceParameter\(skillKey, node\.parameterKey/.test(evaluatorText), true, { evaluatorUsesCandidateParameter: /candidateParameter\(skillKey, node\.parameterKey/.test(evaluatorText), evaluatorUsesSourceParameter: /sourceParameter\(skillKey, node\.parameterKey/.test(evaluatorText) }, '实际侧读取候选固定/等级参数或运行输入');
check('math_expected_uses_raw_source', /rawAt\(|rawCoefficient\(|rawNumberMultiplier\(/.test(expectedText) && !/candidateParameter\(|candidate\.skills\[/.test(expectedText), true, { expectedUsesRawHelpers: /rawAt\(|rawCoefficient\(|rawNumberMultiplier\(/.test(expectedText), expectedUsesCandidate: /candidateParameter\(|candidate\.skills\[/.test(expectedText) }, '期望侧读取冻结原始DataValues和计算树');
check('math_runtime_guard', /fixedValue === null && p\.levelValues === null/.test(mathText) && /缺少候选运行输入/.test(mathText), true, { noDefaultGuard: /fixedValue === null && p\.levelValues === null/.test(mathText), missingRuntimeGuard: /缺少候选运行输入/.test(mathText) }, '运行输入缺失和默认值守卫');

let operationPass = true; let referencePass = true; let integerPass = true; let runtimePass = true; const parameterSets = new Map();
for (const key of candidate.order) {
  const block = skill(key); const set = new Set((block.write.parameters ?? []).map(item => item.parameterKey)); parameterSets.set(key, set);
  for (const item of block.write.formulas ?? []) { operationPass &&= binary(item.expression); for (const ref of parameterRefs(item.expression)) if (!set.has(ref)) referencePass = false; }
  for (const item of block.write.parameters ?? []) { if (item.valueMode === 'RUNTIME_INPUT' && (item.fixedValue !== null || item.levelValues !== null)) runtimePass = false; if (item.parameterKey.endsWith('_ms')) { const values = item.valueMode === 'FIXED' ? [item.fixedValue] : Object.values(item.levelValues ?? {}); if (item.valueType !== 'INTEGER' || values.some(value => !Number.isInteger(value) || value < 0)) integerPass = false; } }
}
check('formula_binary_and_refs', operationPass && referencePass, true, { operationPass, referencePass }, '31条公式运算节点和参数引用');
check('integer_and_runtime_shape', integerPass && runtimePass, true, { integerPass, runtimePass }, '毫秒整数和运行输入无默认');
check('revision_diff_record', revisionDiff.originalCandidateSha256 === 'f13a305499d5cebcf342ce444d3fc9bbd83c53a2a883f0d18d884851bdd0e565' && revisionDiff.candidateSha256 === '9d278c07710b96dc7d29a91df2160ea34954daccb8cf576a0e72492295cf0313' && revisionDiff.changes?.businessWrites === 0, true, revisionDiff, '修订差异记录与原候选/业务写入声明');

const report = { generatedAt: new Date().toISOString(), batch: '英雄机制第三十六批', revision: candidate.meta?.revision, status: checks.every(item => item.pass) ? 'READY' : 'REVISE_REQUIRED', canSave: checks.every(item => item.pass), scope: '修订一候选保存前独立窄审查；不调用业务接口。', files: { candidate: candidatePath, candidateSha256: sha(candidatePath), plan: planPath, planSha256: sha(planPath), math: mathPath, mathSha256: sha(mathPath), sourceBinding: sourcePath, sourceBindingSha256: sha(sourcePath), revisionDiff: diffPath, revisionDiffSha256: sha(diffPath) }, counts: { candidate: candidate.counts, requestCount: plan.requestCount, publicReuse: 30 }, checks, notes: ['修订一新增3项明确参数，移出9项未证通用施法时间/兵野专用上限。', '独立数学实际侧已改为候选参数，期望侧保留冻结原始来源；本报告只做静态检查，未执行业务GET。'], apiCalls: 0, apiWrites: 0, runtimeValidation: '未执行' };
fs.mkdirSync(reviewDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: report.status, canSave: report.canSave, checks: checks.length, passedChecks: checks.filter(item => item.pass).length, candidateSha256: report.files.candidateSha256, planSha256: report.files.planSha256, outputPath: reportPath }));
if (!report.canSave) process.exitCode = 1;
