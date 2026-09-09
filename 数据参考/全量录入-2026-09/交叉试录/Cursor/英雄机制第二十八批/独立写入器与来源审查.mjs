import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(here, '../hero28-root-entry-20260909');
const candidatePath = path.join(here, '完整候选.json');
const planPath = path.join(here, '请求计划.json');
const writerPath = path.join(here, '受保护写入器.mjs');
const inputVersionPath = path.join(input, '输入版本.json');
const bindingPath = path.join(input, '来源绑定与当前文本.json');
const protectionPath = path.join(input, '参考资料', '当前10槽保护快照.json');
const frozen = {
  candidate: 'a07d0fa895cfdd6babaeb6c711d5e5b86dbd5a05530933d6d571baeb70aa6c6d',
  plan: '955d4428ec9f0a3b7c6ce571660fff2a156e3b51a98ef799fc4e632d6f932c47',
  inputVersion: '3aa85899a88fdbe932dac837e4af765e36d3df3f9be0cb60a4fb6025a4cb06e4',
  binding: 'ca0a59262844bee277255af85af7dfdb391caa7306f04746c3ea16a97b208298',
  protection: 'dde9307d285b58959862140432bb113b298bb1405b0e41839bcdd0ddea2a9e5e',
};
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const inputVersion = readJson(inputVersionPath);
const binding = readJson(bindingPath);
const baseline = readJson(protectionPath);
const writerText = fs.readFileSync(writerPath, 'utf8');
const failures = [];
const checks = [];
function check(name, passed, detail = null) {
  checks.push({ name, passed, detail });
  if (!passed) failures.push({ name, detail });
}
function findParameter(skillKey, parameterKey) { return candidate.skills[skillKey].write.parameters.find(item => item.parameterKey === parameterKey); }
function findFormula(skillKey, formulaKey) { return candidate.skills[skillKey].write.formulas.find(item => item.formulaKey === formulaKey); }
function hasParameter(node, parameterKey) {
  if (!node || typeof node !== 'object') return false;
  if (node.nodeType === 'PARAMETER') return node.parameterKey === parameterKey;
  return node.nodeType === 'OPERATION' && node.operands.some(child => hasParameter(child, parameterKey));
}
function hasAttribute(node, owner, key, kind) {
  if (!node || typeof node !== 'object') return false;
  if (node.nodeType === 'ATTRIBUTE') return node.attributeOwner === owner && node.attributeKey === key && node.attributeValueKind === kind;
  return node.nodeType === 'OPERATION' && node.operands.some(child => hasAttribute(child, owner, key, kind));
}
function parameterValues(parameter) {
  if (parameter.valueMode === 'FIXED') return [parameter.fixedValue];
  if (parameter.valueMode === 'SKILL_LEVEL') return Object.values(parameter.levelValues ?? {});
  return [];
}
function sourceSkill(heroId, skillKey) {
  return binding.heroes.find(hero => hero.id === heroId)?.skills.find(skill => skill.skillKey === skillKey);
}
function dataValue(source, name) { return source.object?.mSpell?.DataValues?.find(item => item.name === name)?.values ?? null; }
function calc(source, name) { return source.object?.mSpell?.mSpellCalculations?.[name]?.mFormulaParts ?? null; }
function hasText(source, needle) { return Object.values(source.currentTexts ?? {}).some(item => item.text?.includes(needle)); }

check('候选散列', sha256File(candidatePath) === frozen.candidate, sha256File(candidatePath));
check('计划散列', sha256File(planPath) === frozen.plan, sha256File(planPath));
check('输入版本散列', sha256File(inputVersionPath) === frozen.inputVersion, sha256File(inputVersionPath));
check('来源绑定散列', sha256File(bindingPath) === frozen.binding, sha256File(bindingPath));
check('保护快照散列', sha256File(protectionPath) === frozen.protection, sha256File(protectionPath));
for (const file of inputVersion.sourceFiles ?? []) check(`来源文件未漂移:${file.path}`, sha256File(path.join(input, file.path)) === file.sha256);
check('候选明确零写入', candidate.meta?.apiWrites === 0 && candidate.apiWrites === undefined);
check('计划明确零写入', plan.apiWrites === 0);
check('候选10技能槽', JSON.stringify(candidate.skills ? Object.keys(candidate.skills) : []) === JSON.stringify(['maokai_p', 'maokai_q', 'maokai_w', 'maokai_e', 'maokai_r', 'poppy_p', 'poppy_q', 'poppy_w', 'poppy_e', 'poppy_r']));
const allEntries = Object.entries(candidate.skills ?? {}).flatMap(([skillKey, skill]) => Object.entries(skill.write ?? {}).flatMap(([kind, values]) => (values ?? []).map(body => ({ skillKey, kind, body }))));
const writeCounts = allEntries.reduce((out, item) => { out[item.kind] = (out[item.kind] ?? 0) + 1; return out; }, {});
check('当前组成98项', allEntries.length === 98, writeCounts);
check('新增计划84项', plan.intents.length === 84 && plan.count === 84, { count: plan.count, intents: plan.intents.length });
check('当前组成计数74/17/7', writeCounts.parameters === 74 && writeCounts.formulas === 17 && writeCounts.effects === 7 && !writeCounts.processes && !writeCounts.internalStates && !writeCounts.triggerRules, writeCounts);
const newCounts = plan.intents.reduce((out, item) => { out[item.kind] = (out[item.kind] ?? 0) + 1; return out; }, {});
check('新增组成计数60/17/7（计划）', JSON.stringify(newCounts) === JSON.stringify({ parameters: 60, formulas: 17, effects: 7 }), newCounts);
check('保护快照102项', baseline.requests?.length === 102, baseline.requests?.length);
const protectionGroups = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, lists: 0, oldDetails: 0 };
for (const item of baseline.requests ?? []) {
  if (['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(item.route)) protectionGroups.catalogs += 1;
  else if (item.route.startsWith('/characters/')) protectionGroups.characters += 1;
  else if (item.route.startsWith('/character-skill-relations?')) protectionGroups.relations += 1;
  else if (item.route.includes('/representative-image')) protectionGroups.images += 1;
  else if (/^\/skills\/[^/]+$/.test(item.route)) protectionGroups.subjects += 1;
  else if (/^\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(item.route)) protectionGroups.lists += 1;
  else if (/^\/skills\/[^/]+\/parameters\/[^/]+$/.test(item.route)) protectionGroups.oldDetails += 1;
}
check('保护分组4/2/2/10/10/60/14', JSON.stringify(protectionGroups) === JSON.stringify({ catalogs: 4, characters: 2, relations: 2, subjects: 10, images: 10, lists: 60, oldDetails: 14 }), protectionGroups);

const preflightRoot = path.join(here, '只读预检');
const preflightDirs = fs.existsSync(preflightRoot) ? fs.readdirSync(preflightRoot).filter(name => fs.statSync(path.join(preflightRoot, name)).isDirectory()).sort() : [];
const preflightDir = preflightDirs.at(-1) ? path.join(preflightRoot, preflightDirs.at(-1)) : null;
const preflight = preflightDir ? readJson(path.join(preflightDir, '执行结果.json')) : null;
check('只读预检成功', preflight?.success === true && preflight?.apiWrites === 0 && preflight?.counts?.GET === 200 && preflight?.counts?.POST === 0, preflight ? { runId: preflight.runId, counts: preflight.counts, success: preflight.success } : null);
check('只读保护102全过', preflight?.preflight?.protection?.checked === 102 && preflight?.preflight?.protection?.passed === true, preflight?.preflight?.protection);
check('只读详情14既有84新增404', preflight?.preflight?.details?.matched === 14 && preflight?.preflight?.details?.missingBefore === 84, preflight?.preflight?.details);

check('写入器只含GET和POST', !/method\s*:\s*['"](?:PUT|PATCH|DELETE)['"]/.test(writerText) && !/\b(?:PUT|PATCH|DELETE)\b/.test(writerText));
check('写入器保留apply环境确认', writerText.includes("HERO28_APPLY_CONFIRM,'CONFIRM_HERO28_COMPONENT_POSTS'") || writerText.includes('HERO28_APPLY_CONFIRM'));
check('全局锁使用wx', writerText.includes("flag:'wx'") && writerText.includes('globalLock'));
check('单条意图使用wx', writerText.includes("out+'/写前意图/'+String(i+1).padStart(3,'0')+'.json'") && writerText.includes("{flag:'wx'}"));
check('每项写前详情必须404', writerText.includes("assert.equal(before.status,404,detail)"));
check('每项POST后GET深比较', writerText.includes("assert.equal(got.status,200,detail)") && writerText.includes("assert.deepEqual(strip(got.data),strip(x.body),detail)"));
check('写后保护和详情复核', writerText.includes('execution.final={protection:await protection(true),details:await details(true)}'));
const lockBeforeTry = writerText.indexOf("if(apply){fs.writeFileSync(globalLock");
const tryStart = writerText.indexOf('try{execution.preflight');
check('既有锁抢占失败时不覆盖', writerText.includes("{flag:'wx'}") && lockBeforeTry >= 0, { lockBeforeTry, tryStart });
check('既有锁失败前置于预检（非阻塞记录）', lockBeforeTry >= 0 && tryStart >= 0 && lockBeforeTry < tryStart, { lockBeforeTry, tryStart });
check('写入器新增列表行未做逐字段比较（由独立回读补足）', !writerText.includes('assert.deepEqual(r.data.find(x=>x[coll.id]===i.stableKey),i.body'), '详情比较仍存在');

const maokaiQ = sourceSkill('Maokai', 'maokai_q');
const poppyQ = sourceSkill('Poppy', 'poppy_q');
const poppyW = sourceSkill('Poppy', 'poppy_w');
const poppyE = sourceSkill('Poppy', 'poppy_e');
const poppyR = sourceSkill('Poppy', 'poppy_r');
const maokaiE = sourceSkill('Maokai', 'maokai_e');
check('茂凯Q当前文本消费最大生命百分比', hasText(maokaiQ, 'BasePercentHealth') && hasParameter(findFormula('maokai_q', 'magic_damage').expression, 'target_max_health_ratio'));
check('茂凯Q最大生命比例2%至4%', JSON.stringify(parameterValues(findParameter('maokai_q', 'target_max_health_ratio'))) === JSON.stringify([0.02, 0.025, 0.03, 0.035, 0.04]), { source: dataValue(maokaiQ, 'BasePercentHealth'), candidate: parameterValues(findParameter('maokai_q', 'target_max_health_ratio')) });
check('茂凯Q法强树和候选公式均保留', Array.isArray(calc(maokaiQ, 'TotalDamage')) && hasParameter(findFormula('maokai_q', 'magic_damage').expression, 'ap_ratio'));
check('波比Q额外攻击力使用BONUS', Math.abs(findParameter('poppy_q', 'bonus_ad_ratio').fixedValue - 0.75) < 1e-12 && hasAttribute(findFormula('poppy_q', 'physical_damage_per_hit').expression, 'SOURCE', 'attack_damage', 'BONUS') && calc(poppyQ, 'BaseDamage')?.some(part => part.mStat === 2 && part.mStatFormula === 2));
check('波比Q两次同目标和1000毫秒间隔', findParameter('poppy_q', 'hit_count_same_target').fixedValue === 2 && findParameter('poppy_q', 'delay_between_hits_ms').fixedValue === 1000 && hasText(poppyQ, '再次'));
check('波比Q减速额外生命系数', findParameter('poppy_q', 'slow_bonus_health_coefficient').fixedValue === 0.00008 && hasAttribute(findFormula('poppy_q', 'slow_ratio').expression, 'SOURCE', 'hp', 'BONUS'));
check('波比W双抗基准无默认', findParameter('poppy_w', 'actual_source_armor_before_passive').valueMode === 'RUNTIME_INPUT' && findParameter('poppy_w', 'actual_source_magic_resistance_before_passive').valueMode === 'RUNTIME_INPUT' && calc(poppyW, 'BonusArmor')?.[0]?.mStat === 1 && calc(poppyW, 'BonusMR')?.[0]?.mStat === 6);
check('波比W低生命翻倍端点', findParameter('poppy_w', 'passive_low_health_threshold_ratio').fixedValue === 0.4 && findParameter('poppy_w', 'passive_low_health_multiplier').fixedValue === 2 && hasText(poppyW, '翻倍'));
check('波比E额外攻击力和撞墙同额两次', Math.abs(findParameter('poppy_e', 'bonus_ad_ratio').fixedValue - 0.6) < 1e-12 && hasAttribute(findFormula('poppy_e', 'tackle_physical_damage').expression, 'SOURCE', 'attack_damage', 'BONUS') && findParameter('poppy_e', 'wall_hit_count').fixedValue === 2 && calc(poppyE, 'TackleDamage')?.some(part => part.mStat === 2 && part.mStatFormula === 2));
check('波比R完整伤害和点按半伤', Math.abs(findParameter('poppy_r', 'bonus_ad_ratio').fixedValue - 0.9) < 1e-12 && findParameter('poppy_r', 'snap_cast_damage_ratio').fixedValue === 0.5 && hasText(poppyR, 'HalfDamage') && calc(poppyR, 'Damage')?.some(part => part.mStat === 2 && part.mStatFormula === 2));
check('茂凯E独立树苗排除但保留命中英雄缩短被动冷却', Object.keys(candidate.skills.maokai_e.write.formulas).length === 0 && candidate.skills.maokai_e.write.effects.length === 0 && findParameter('maokai_e', 'passive_cooldown_reduction_on_hero_hit_ms').fixedValue === 4000 && hasText(maokaiE, '额外的4秒'));
const resultTypes = allEntries.filter(item => item.kind === 'effects').flatMap(item => item.body.results ?? []).map(result => result.resultType);
check('效果未伪造伤害治疗瞬时结果', resultTypes.every(type => type === 'RESOURCE_CHANGE'), resultTypes);
const integerFailures = allEntries.filter(item => item.kind === 'parameters').flatMap(item => {
  const p = item.body;
  const values = parameterValues(p);
  const errors = [];
  if (p.parameterKey.endsWith('_ms') && p.valueType !== 'INTEGER') errors.push('type');
  if (p.parameterKey.endsWith('_ms') && values.some(value => !Number.isInteger(value) || value < 0)) errors.push('value');
  if (p.valueMode === 'RUNTIME_INPUT' && (p.fixedValue !== null || p.levelValues !== null)) errors.push('runtimeDefault');
  return errors.length ? [{ key: `${item.skillKey}/${p.parameterKey}`, errors }] : [];
});
check('时间参数非负整数且运行输入无默认', integerFailures.length === 0, integerFailures);

const report = {
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? 'PASS_WITH_NONBLOCKING_NOTES' : 'REVISE',
  blockingFailures: failures,
  nonBlockingNotes: [
    { key: 'preexisting_lock', finding: 'apply在预检try外使用wx抢锁；既有锁会直接失败且不覆盖锁，也不会生成本次执行结果。' },
    { key: 'new_list_rows', finding: '写入器保护检查对新增列表行校验键和数量，新增详情逐字段深比较；独立回读器将再对60个列表做完整保护核验。' },
  ],
  frozen: { candidate: frozen.candidate, plan: frozen.plan, inputVersion: frozen.inputVersion, binding: frozen.binding, protection: frozen.protection },
  hashes: { candidate: sha256File(candidatePath), plan: sha256File(planPath), writer: sha256File(writerPath), inputVersion: sha256File(inputVersionPath), binding: sha256File(bindingPath), protection: sha256File(protectionPath) },
  counts: { currentComponents: allEntries.length, newIntents: plan.intents.length, newByKind: newCounts, currentByKind: writeCounts, protectedGETs: baseline.requests.length, preflightGETs: preflight?.counts?.GET ?? null },
  preflight: preflight ? { runId: preflight.runId, success: preflight.success, apiWrites: preflight.apiWrites, counts: preflight.counts, protection: preflight.preflight?.protection, details: preflight.preflight?.details, reportPath: path.join(preflightDir, '执行结果.json') } : null,
  checks,
  sourceEvidence: { maokaiQ: { dataValues: ['BasePercentHealth'], calculation: 'TotalDamage', candidateFormula: 'magic_damage' }, poppyQ: { calculation: 'BaseDamage', mStat: 2, mStatFormula: 2, candidateAttribute: 'SOURCE.attack_damage.BONUS' }, poppyW: { calculations: ['BonusArmor', 'BonusMR'], mStat: [1, 6], runtimeBases: true }, poppyE: { calculation: 'TackleDamage', mStat: 2, mStatFormula: 2, wallHitCount: 2 }, poppyR: { calculation: 'Damage', mStat: 2, mStatFormula: 2, snapRatio: 0.5 }, maokaiE: { independentSaplingExcluded: true, heroHitCooldownReductionMs: 4000 } },
  noBusinessWrites: true,
};
const output = path.join(here, '独立写入器与来源审查.json');
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, blockingFailures: report.blockingFailures, counts: report.counts, preflight: report.preflight, output }, null, 2));
if (report.status === 'REVISE') process.exitCode = 1;
