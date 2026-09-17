import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = 'C:/project/damage_web_dev';
const dir = path.join(root, '.agents', 'artifacts', 'hero35-luna-candidate', '修订一');
const input = path.join(root, '.agents', 'artifacts', 'hero35-root-entry-20260910');
const candidatePath = path.join(dir, '完整候选.json');
const planPath = path.join(dir, '写前请求计划.json');
const sourcePath = path.join(input, '来源绑定与当前文本.json');
const reportPath = path.join(root, '.agents', 'artifacts', 'hero35-independent-review', '候选审查-修订一.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const source = readJson(sourcePath);
const sourceSkills = new Map(source.heroes.flatMap(hero => hero.skills).map(skill => [skill.skillKey, skill]));
const results = [];
const check = (id, pass, expected, actual, evidence) => results.push({ id, pass: Boolean(pass), expected, actual, evidence });
const skill = key => candidate.skills[key];
const params = key => new Map((skill(key)?.write?.parameters ?? []).map(item => [item.parameterKey, item]));
const formulas = key => new Map((skill(key)?.write?.formulas ?? []).map(item => [item.formulaKey, item]));
const rawCalc = (key, name) => sourceSkills.get(key)?.object?.mSpell?.mSpellCalculations?.[name];
const walk = (node, callback) => {
  if (!node || typeof node !== 'object') return;
  callback(node);
  for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value, callback);
};
const refs = node => { const out = []; walk(node, item => { if (item.nodeType === 'PARAMETER') out.push(item.parameterKey); }); return out; };
const attrs = node => { const out = []; walk(node, item => { if (item.nodeType === 'ATTRIBUTE') out.push(item); }); return out; };
const binary = node => { let pass = true; walk(node, item => { if (item.nodeType === 'OPERATION' && (!Array.isArray(item.operands) || item.operands.length !== 2)) pass = false; }); return pass; };

check('candidate_sha256', sha(candidatePath) === '0e07e0926380fa098ab3155a47fd3503e00aed7bc7088f4f6bb6c54133bbb383', '0e07e0926380fa098ab3155a47fd3503e00aed7bc7088f4f6bb6c54133bbb383', sha(candidatePath), '修订一候选实际字节');
check('plan_sha256', sha(planPath) === '9f610f2d19b05ff34ff5e30c4246bd6a97c2405d28538e9678f1477b99589192', '9f610f2d19b05ff34ff5e30c4246bd6a97c2405d28538e9678f1477b99589192', sha(planPath), '修订一请求计划实际字节');
check('source_index', candidate.meta.sourceIndexSha256 === source.sourceIndexSha256, candidate.meta.sourceIndexSha256, source.sourceIndexSha256, '候选与来源绑定索引一致');
check('counts', JSON.stringify(candidate.counts) === JSON.stringify({ newParameters: 137, newFormulas: 32, newEffects: 2, newProcesses: 0, newInternalStates: 0, newTriggerRules: 0, newTotal: 171, reusedPublicParameters: 28, plannedTotalIncludingReused: 199, protectedCurrentCompositionLists: 120 }), candidate.counts, candidate.counts, '修订一计数');
check('plan_counts', plan.requestCount === 171 && JSON.stringify(plan.requestCounts) === JSON.stringify({ parameters: 137, formulas: 32, effects: 2, processes: 0, internalStates: 0, triggerRules: 0 }), { requestCount: 171, requestCounts: { parameters: 137, formulas: 32, effects: 2 } }, { requestCount: plan.requestCount, requestCounts: plan.requestCounts }, '修订一计划计数');
check('no_business_writes', candidate.meta.businessWrites === 0 && candidate.meta.apiCalls === 0 && candidate.meta.tokenStored === false && candidate.apiWrites === 0, true, { businessWrites: candidate.meta.businessWrites, apiCalls: candidate.meta.apiCalls, tokenStored: candidate.meta.tokenStored, apiWrites: candidate.apiWrites }, '静态候选无业务写入');

const braumQ = formulas('braum_q').get('magic_damage');
const braumQAttr = attrs(braumQ?.expression)[0];
const braumQSource = rawCalc('braum_q', 'TotalDamage')?.mFormulaParts?.[1];
check('braum_q_source_max_hp', braumQSource?.mStat === 12 && braumQAttr?.attributeOwner === 'SOURCE' && braumQAttr?.attributeKey === 'hp' && braumQAttr?.attributeValueKind === 'TOTAL' && refs(braumQ.expression).includes('source_max_hp_ratio'), true, { mStat: 12, attribute: 'SOURCE.hp.TOTAL', ratio: 0.025 }, { source: braumQSource, attribute: braumQAttr, refs: refs(braumQ?.expression), ratio: params('braum_q').get('source_max_hp_ratio') }, '布隆Q最大生命按来源属性并保留0.025');
const braumWArmor = formulas('braum_w').get('self_armor_bonus');
const braumWMR = formulas('braum_w').get('self_magic_resistance_bonus');
check('braum_w_armor_runtime', params('braum_w').get('actual_armor_stage')?.valueMode === 'RUNTIME_INPUT' && refs(braumWArmor?.expression).includes('actual_armor_stage') && attrs(braumWArmor?.expression).length === 0, true, params('braum_w').get('actual_armor_stage'), 'mStat1/mStatFormula2未证属性阶段改运行输入');
const braumWMRAttr = attrs(braumWMR?.expression)[0];
check('braum_w_mr_mapping', braumWMRAttr?.attributeOwner === 'SOURCE' && braumWMRAttr?.attributeKey === 'magic_resistance' && braumWMRAttr?.attributeValueKind === 'BONUS', 'SOURCE.magic_resistance.BONUS', braumWMRAttr, 'mStat6/mStatFormula2已有魔抗窄证');
const affectedDescriptions = [
  ['taric_p', 'actual_armor_stage', params('taric_p').get('actual_armor_stage')?.description],
  ['taric_p', 'empowered_attack_extra_magic_damage', formulas('taric_p').get('empowered_attack_extra_magic_damage')?.description],
  ['taric_w', 'self_armor_bonus', formulas('taric_w').get('self_armor_bonus')?.description],
  ['taric_e', 'actual_armor_stage', params('taric_e').get('actual_armor_stage')?.description],
  ['taric_e', 'magic_damage', formulas('taric_e').get('magic_damage')?.description],
];
check('taric_stage_descriptions_neutral', affectedDescriptions.every(([, , text]) => typeof text === 'string' && !/(施放前|施加前|施加时)/.test(text) && (!text.includes('额外护甲') || text.includes('不声明') || text.includes('不在证据不足时指定'))), true, affectedDescriptions, '塔里克P/W/E不再将未证阶段写成额外护甲或固定时点');
check('taric_runtime_stage_refs', ['taric_p', 'taric_w', 'taric_e'].every(key => [...params(key).values()].filter(item => item.parameterKey === 'actual_armor_stage').every(item => item.valueMode === 'RUNTIME_INPUT')), true, ['taric_p', 'taric_w', 'taric_e'].map(key => [key, params(key).get('actual_armor_stage')]), '塔里克三处护甲阶段无默认输入');

let operationPass = true;
let referencePass = true;
let millisecondsPass = true;
let runtimePass = true;
let effectFieldsPass = true;
let planBodiesPass = plan.requests?.length === 171;
const writeByKey = new Map();
for (const key of candidate.order) {
  const value = skill(key);
  for (const item of value.write.parameters ?? []) writeByKey.set(`${key}|parameters|${item.parameterKey}`, item);
  for (const item of value.write.formulas ?? []) { writeByKey.set(`${key}|formulas|${item.formulaKey}`, item); operationPass &&= binary(item.expression); for (const ref of refs(item.expression)) if (!params(key).has(ref)) referencePass = false; }
  for (const item of value.write.effects ?? []) { writeByKey.set(`${key}|effects|${item.effectKey}`, item); if (!item.results?.every(result => Object.hasOwn(result, 'spellShieldBlockScope'))) effectFieldsPass = false; for (const result of item.results ?? []) { const valueRule = result.valueRule?.value; if (valueRule?.kind === 'PARAMETER' && !params(key).has(valueRule.parameterKey)) referencePass = false; if (valueRule?.kind === 'FORMULA' && !formulas(key).has(valueRule.formulaKey)) referencePass = false; } }
  for (const item of value.write.parameters ?? []) { if (item.valueMode === 'RUNTIME_INPUT' && (item.fixedValue !== null || item.levelValues !== null)) runtimePass = false; if (item.parameterKey.endsWith('_ms')) { const values = item.valueMode === 'FIXED' ? [item.fixedValue] : Object.values(item.levelValues ?? {}); if (item.valueType !== 'INTEGER' || values.some(value => !Number.isInteger(value) || value < 0)) millisecondsPass = false; } }
}
for (const intent of plan.requests ?? []) if (!writeByKey.has(`${intent.skillKey}|${intent.kind}|${intent.stableKey}`) || JSON.stringify(writeByKey.get(`${intent.skillKey}|${intent.kind}|${intent.stableKey}`)) !== JSON.stringify(intent.body)) planBodiesPass = false;
check('all_formula_operations_binary', operationPass, true, operationPass, '全部公式运算节点二元');
check('all_refs_exist', referencePass, true, referencePass, '公式与效果引用均在技能写入集合内');
check('milliseconds_integer_nonnegative', millisecondsPass, true, millisecondsPass, '所有毫秒参数为非负整数');
check('runtime_no_defaults', runtimePass, true, runtimePass, '运行输入无固定值或等级默认');
check('effects_nullable_scope', effectFieldsPass, true, effectFieldsPass, '效果结果显式保留spellShieldBlockScope');
check('plan_bodies_match', planBodiesPass, true, planBodiesPass, '计划请求体与修订一候选逐项一致');

const passed = results.every(item => item.pass);
const report = { generatedAt: new Date().toISOString(), status: passed ? 'READY' : 'REVISE_REQUIRED', canSave: passed, scope: '第35批修订一保存前窄范围独立审查；不调用业务接口。', files: { candidate: candidatePath, candidateSha256: sha(candidatePath), plan: planPath, planSha256: sha(planPath), sourceBinding: sourcePath, sourceBindingSha256: sha(sourcePath) }, counts: { candidate: candidate.counts, plan: { requestCount: plan.requestCount, requestCounts: plan.requestCounts } }, checks: results, apiWrites: 0, apiCalls: 0, runtimeValidation: '未执行' };
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: report.status, canSave: report.canSave, checks: results.length, passedChecks: results.filter(item => item.pass).length, candidateSha256: report.files.candidateSha256, planSha256: report.files.planSha256, outputPath: reportPath }));
if (!passed) process.exitCode = 1;
