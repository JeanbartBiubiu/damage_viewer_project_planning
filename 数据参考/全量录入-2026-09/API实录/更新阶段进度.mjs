import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const readAbsolute = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data, null, 2) + '\n');
const heroes = read('API实录/英雄全量核对/汇总.json');
const skills = read('API实录/技能/summary.json');
const skillPlan = read('英雄技能全量页面输入/skills-basic-plan.json').skills;
const equipment = read('API实录/装备/summary.json');
const pureEquipment = read('实录记录.json');
const heroSkillImages = read('API实录/图片/full-relation-verification.json');
const equipmentImages = read('API实录/装备图片/代表图关系最终核对.json');
const scopePlan = read('1V1范围筛选/处置清单.json');
const asheMechanism = read('艾希技能实录第一批/独立核对.json');
const equipmentMechanism = read('装备技能实录/Luna第一批/主负责人复核.json');
const equipmentSecondEvidence = '装备技能实录/Luna第二批/护盾消费纠错/批次复核.json';
const equipmentSecond = read(equipmentSecondEvidence);
const equipmentThirdEvidence = '装备技能实录/Luna第三批/主负责人复核.json';
const equipmentThird = read(equipmentThirdEvidence);
const equipmentFourthEvidence = '装备技能实录/Luna第四批/纠错后独立回读.json';
const equipmentFourth = read(equipmentFourthEvidence);
assert.deepEqual(equipmentFourth.summary.counts, {parameters:9, formulas:3, effects:4, processes:0, 'internal-states':0, 'trigger-rules':0});
assert.equal(equipmentFourth.summary.skillCount, 5);
assert.equal(equipmentFourth.summary.mismatches + equipmentFourth.summary.missing + equipmentFourth.summary.unexpected, 0);
const equipmentFifthEvidence = '装备技能实录/Luna第五批/独立最终回读.json';
const equipmentFifth = read(equipmentFifthEvidence);
assert.equal(equipmentFifth.objects.length, 6);
assert.equal(equipmentFifth.summary.fieldCount, 276);
assert.equal(equipmentFifth.summary.mismatchCount + equipmentFifth.summary.failedCheckCount + equipmentFifth.summary.statusFailureCount, 0);
const equipmentSixthEvidence = '装备技能实录/Luna第六批/独立最终回读.json';
const equipmentSixth = read(equipmentSixthEvidence);
assert.equal(equipmentSixth.objects.length, 6);
assert.deepEqual(equipmentSixth.summary, {objectCount:6, checkCount:56, fieldCount:524, mismatchCount:0, failedCheckCount:0});
assert.equal(read('装备技能实录/Luna第六批/页面验收.json').passed, true);
const equipmentSeventhEvidence = '装备技能实录/Luna第七批/独立最终回读.json';
const equipmentSeventh = read(equipmentSeventhEvidence);
assert.equal(equipmentSeventh.objects.length, 6);
assert.deepEqual(equipmentSeventh.summary, {objectCount:6, checkCount:74, fieldCount:721, mismatchCount:0, failedCheckCount:0});
assert.equal(read('装备技能实录/Luna第七批/页面验收.json').passed, true);
const equipmentEighthEvidence = '装备技能实录/Luna第八批/逐字段回读证据.json';
const equipmentEighth = read(equipmentEighthEvidence);
assert.equal(equipmentEighth.objects.length, 6);
assert.equal(equipmentEighth.summary.componentCount, 79);
assert.equal(equipmentEighth.summary.fieldCount, 915);
assert.equal(equipmentEighth.summary.mismatchCount + equipmentEighth.summary.missingCount, 0);
const equipmentEighthCorrectionEvidence='装备技能实录/Luna第八批/独立最终回读-纠错-2026-09-08T02-32-25.547Z.json';
const equipmentEighthCorrection=read(equipmentEighthCorrectionEvidence);
assert.equal(equipmentEighthCorrection.passed,true);
assert.deepEqual(equipmentEighthCorrection.summary,{operationCount:26,operationTargetCount:26,skillCount:6,equipmentCount:6,modifierZoneCount:4,failureCount:0});
assert.equal(read('装备技能实录/Luna第八批/页面验收.json').passed, true);
const equipmentNinthEvidence = '装备技能实录/Luna第九批/独立最终回读.json';
const equipmentNinth = read(equipmentNinthEvidence);
const equipmentEleventhEvidence = '装备技能实录/第十一批范围与轻灵鞋/独立最终回读.json';
const equipmentEleventh = read(equipmentEleventhEvidence);
assert.equal(equipmentEleventh.passed, true);
assert.deepEqual(equipmentEleventh.summary, { equipmentCount:5, fullReadCount:22, addedAttributeDefinitions:1, addedEquipmentAttributeValues:1, outOfScopeEffectEquipment:4, arithmeticCount:5, mismatchCount:0 });
assert.equal(read('装备技能实录/第十一批范围与轻灵鞋/页面验收.json').passed, true);
assert.equal(equipmentNinth.summary.objectCount, 6);
assert.equal(equipmentNinth.summary.checkCount, 115);
assert.equal(equipmentNinth.summary.fieldCount, 753);
assert.equal(equipmentNinth.summary.failedCheckCount + equipmentNinth.summary.mismatchCount, 0);
assert.equal(read('装备技能实录/Luna第九批/页面验收.json').passed, true);
assert.equal(equipmentThird.passed, true);
assert.equal(equipmentThird.components, 76);
assert.equal(equipmentSecond.passed, true);
assert.equal(equipmentSecond.components, 54);
assert.equal(equipmentSecond.records.length, 6);
const publicParameterEvidence = '技能公共参数实录/独立核对.json';
const publicParameters = read(publicParameterEvidence);
const publicParameterSecondEvidence = '技能公共参数第二批/独立核对.json';
const publicParametersSecond = read(publicParameterSecondEvidence);
assert.equal(publicParametersSecond.passed, true);
assert.deepEqual(publicParametersSecond.counts, {verifiedParameters:95, verifiedSkills:57, created:0, missing:0, conflicts:0});
const publicParameterThirdEvidence = '技能公共参数第三批/独立核对.json';
const publicParametersThird = read(publicParameterThirdEvidence);
assert.equal(publicParametersThird.passed, true);
assert.deepEqual(publicParametersThird.counts, {verifiedParameters:151, verifiedSkills:83, created:0, missing:0, conflicts:0});
const publicParameterFourthEvidence = '技能公共参数第四批/独立核对.json';
const publicParametersFourth = read(publicParameterFourthEvidence);
assert.equal(publicParametersFourth.passed, true);
assert.deepEqual(publicParametersFourth.counts, {verifiedParameters:158, verifiedSkills:89, created:0, missing:0, conflicts:0});
const publicParameterFifthEvidence = '技能公共参数第五批/独立核对.json';
const publicParametersFifth = read(publicParameterFifthEvidence);
assert.equal(publicParametersFifth.passed, true);
assert.deepEqual(publicParametersFifth.counts, {verifiedParameters:152, verifiedSkills:86, created:0, missing:0, conflicts:0});
assert.equal(read('技能公共参数第五批/页面验收.json').passed, true);
const publicParameterSixthEvidence = '技能公共参数第六批/独立核对.json';
const publicParametersSixth = read(publicParameterSixthEvidence);
assert.equal(publicParametersSixth.passed, true);
assert.deepEqual(publicParametersSixth.counts, {verifiedParameters:148, verifiedSkills:89, created:0, missing:0, conflicts:0});
assert.equal(read('技能公共参数第六批/页面验收.json').passed, true);
const publicParameterSeventhEvidence = '技能公共参数第七批/独立核对.json';
const publicParametersSeventh = read(publicParameterSeventhEvidence);
assert.equal(publicParametersSeventh.passed, true);
assert.deepEqual(publicParametersSeventh.counts, {verifiedParameters:181, verifiedSkills:106, created:0, missing:0, conflicts:0});
assert.equal(read('技能公共参数第七批/页面验收.json').passed, true);
const nasusEvidence = '内瑟斯技能实录第一批/独立核对.json';
const nasusMechanism = read(nasusEvidence);
const nasusInitializationEvidence = '内瑟斯技能实录第一批/初始化回读.json';
const nasusInitialization = read(nasusInitializationEvidence);
assert.equal(nasusInitialization.passed, true);
assert.equal(nasusInitialization.rule.eventSource.eventType, 'SOURCE_INITIALIZED');
assert.equal(nasusMechanism.passed, true);
assert.deepEqual(nasusMechanism.counts, { parameters: 24, formulas: 6, effects: 7, processes: 3 });
assert.equal(nasusMechanism.missing.length, 0);
assert.equal(nasusMechanism.conflicts.length, 0);
assert.equal(publicParameters.passed, true);
assert.equal(publicParameters.counts.verifiedParameters, 110);
assert.equal(publicParameters.counts.verifiedSkills, 61);
assert.equal(publicParameters.counts.missing, 0);
assert.equal(publicParameters.counts.conflicts, 0);
const luxEvidenceWorktree = path.resolve(root, '..', '..', '..', 'damage_web_dev');
const luxEvidenceRelative = '数据参考/全量录入-2026-09/交叉试录/Cursor/拉克丝机制第一批/回读摘要.json';
const luxReadbackSummaryRelative = '数据参考/全量录入-2026-09/交叉试录/Cursor/拉克丝机制第一批/逐对象回读.json';
const luxMechanism = readAbsolute(path.join(luxEvidenceWorktree, luxEvidenceRelative));
const heroSecondRelative = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二批/回读摘要.json';
const heroSecond = readAbsolute(path.join(luxEvidenceWorktree, heroSecondRelative));
assert.equal(heroSecond.componentsChecked, 206);
assert.deepEqual(heroSecond.failures, []);
assert.equal(Object.keys(heroSecond.skills).length, 20);
const heroThirdRelative = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第三批/护盾消费纠错/批次回读摘要.json';
const heroThird = readAbsolute(path.join(luxEvidenceWorktree, heroThirdRelative));
assert.equal(heroThird.componentsChecked, 210);
assert.deepEqual(heroThird.failures, []);
assert.deepEqual(heroThird.totals, {parameters:127, formulas:24, effects:39, processes:12, internalStates:0, triggerRules:8});
assert.equal(Object.keys(heroThird.skills).length, 20);
const heroFourthRelative = '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第四批/最终回读摘要.json';
const heroFourth = readAbsolute(path.join(luxEvidenceWorktree, heroFourthRelative));
assert.equal(heroFourth.componentsChecked, 230);
assert.deepEqual(heroFourth.failures, []);
assert.deepEqual(heroFourth.totals, {parameters:138, formulas:26, effects:44, processes:11, internalStates:0, triggerRules:11});
assert.equal(heroFourth.subjectCount, 20);
assert.equal(heroFourth.listCount, 120);
assert.equal(heroFourth.arithmeticCount, 100);
assert.equal(heroFourth.invariantCount, 20);
assert.equal(readAbsolute(path.join(luxEvidenceWorktree, path.dirname(heroFourthRelative), '页面验收.json')).passed, true);
const luxReadbackSummary = readAbsolute(path.join(luxEvidenceWorktree, luxReadbackSummaryRelative));
assert.equal(heroes.coverage.checked, 171);
assert.equal(heroes.totals.missingValues, 0);
assert.equal(heroes.totals.valueDifferences, 0);
assert.equal(skills.verifiedSkills, 855);
assert.equal(skills.verifiedRelations, 855);
assert.equal(equipment.results.filter(x => x.status === 'completed').length, 134);
assert.equal(pureEquipment.records.length, 47);
assert.equal(heroSkillImages.summary.checked, 1026);
assert.equal(heroSkillImages.summary.failures, 0);
assert.equal(heroSkillImages.summary.disabled, 0);
assert.equal(equipmentImages.linked, 134);
assert.equal(equipmentImages.failed, 0);
assert.equal(equipmentImages.disabled, 0);

const scopeItems = scopePlan.items;
assert.equal(scopeItems.length, 6);
for (const item of scopeItems) assert.equal(item.api.status, 200, item.skillKey);
const scopeSkippedKeys = scopeItems.filter(item => item['分类'] === '范围外技能').map(item => item.skillKey).sort();
const scopeMixedKeys = scopeItems.filter(item => item['分类'] === '混合技能候选').map(item => item.skillKey).sort();
assert.deepEqual(scopeSkippedKeys, ['ashe_e', 'twistedfate_p', 'zilean_p']);
assert.deepEqual(scopeMixedKeys, ['draven_p', 'gangplank_q', 'lux_w']);
assert.equal(scopeItems.find(item => item.skillKey === 'draven_p')['处置']['跨技能依赖']['引用技能'].apiStatus, 200);
assert.equal(asheMechanism.mechanismStatus, '部分录入');
assert.equal(asheMechanism.runtimeStatus, '未执行');
assert.deepEqual(asheMechanism.counts, { parameters: 13, formulas: 2, effects: 4 });

const luxSkillReads = Object.values(luxMechanism.finalGet ?? {});
assert.equal(luxSkillReads.length, 5);
const luxCounts = luxSkillReads.reduce((sum, skill) => ({
  parameters: sum.parameters + skill.parameters.length,
  formulas: sum.formulas + skill.formulas.length,
  effects: sum.effects + skill.effects.length,
  processes: sum.processes + skill.processes.length,
  triggerRules: sum.triggerRules + skill['trigger-rules'].length,
}), { parameters: 0, formulas: 0, effects: 0, processes: 0, triggerRules: 0 });
assert.deepEqual(luxCounts, { parameters: 37, formulas: 5, effects: 8, processes: 4, triggerRules: 2 });
assert.deepEqual(luxMechanism.occupiedConflicts, []);
assert.deepEqual(luxReadbackSummary.occupiedConflicts, []);
assert.deepEqual(luxReadbackSummary.failures, []);

assert.equal(equipmentMechanism.passed, true);
assert.equal(equipmentMechanism.records.length, 2);
assert.deepEqual(equipmentMechanism.records.map(record => record.skillKey).sort(), ['item_3091_passive', 'item_3115_passive']);
assert.equal(equipmentMechanism.records.reduce((sum, record) => sum + record.parameterCount, 0), 3);
assert.equal(equipmentMechanism.records.reduce((sum, record) => sum + record.formulaCount, 0), 1);
assert.equal(equipmentMechanism.records.filter(record => record.effect && record.rule && record.relation).length, 2);
assert.equal(equipmentMechanism.records.filter(record => record.skillImage?.image?.enabled && record.skillImage.image.imageKey === record.itemKey).length, 2);

const entries = fs.readFileSync(path.join(root, '英雄/录入进度.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
for (const entry of entries) {
  if (['Sylas', 'Aphelios'].includes(entry.sourceChampionId)) continue;
  if (entry.objectType === '角色') {
    const proof = heroes.items.find(x => x.sourceFile === `${entry.sourceChampionId}.json`);
    assert.ok(proof, entry.entryKey);
    entry.status = '部分录入';
    entry.systemObjectKey = proof.characterKey;
    entry.apiVerifiedAt = proof.checkedAt;
    entry.apiEvidence = `API实录/英雄全量核对/${proof.characterKey}.json`;
    entry.note = `主体及有明确来源的 ${proof.sourceExplicitAttributes} 项基础属性、${proof.sourceExplicitValues} 个等级值已核对；技能基本资料和角色关联已建立，完整技能机制及来源缺失项另列待录。`;
  } else if (entry.objectType === '技能') {
    const plan = skillPlan.find(x => x.sourceChampionId === entry.sourceChampionId && x.key.endsWith(`_${entry.slot.toLowerCase()}`));
    assert.ok(plan, entry.entryKey);
    const proof = read(`API实录/技能/records/${plan.key}.json`);
    assert.equal(proof.status, 'verified');
    entry.status = '部分录入';
    entry.systemObjectKey = plan.key;
    entry.apiVerifiedAt = proof.at;
    entry.apiEvidence = `API实录/技能/records/${plan.key}.json`;
    entry.note = '基本资料及角色关联已保存并独立回读；原始说明中的变量、完整数值及机制仍需逐项补证和配置，不能记为完整技能。';
  }
}
const scopeEvidence = '1V1范围筛选/处置清单.json';
for (const [parameterBatch, parameterEvidence] of [[publicParameters, publicParameterEvidence], [publicParametersSecond, publicParameterSecondEvidence], [publicParametersThird, publicParameterThirdEvidence], [publicParametersFourth, publicParameterFourthEvidence], [publicParametersFifth, publicParameterFifthEvidence], [publicParametersSixth, publicParameterSixthEvidence], [publicParametersSeventh, publicParameterSeventhEvidence]]) {
for (const skillKey of new Set(parameterBatch.records.map(record => record.skillKey))) {
  const entry = entries.find(candidate => candidate.objectType === '技能' && candidate.systemObjectKey === skillKey);
  assert.ok(entry, skillKey);
  const records = parameterBatch.records.filter(record => record.skillKey === skillKey);
  assert.ok(records.every(record => record.matches === true));
  entry.publicParameters = { keys: records.map(record => record.expected.parameterKey),
    checkedAt: records.at(-1).checkedAt, evidence: parameterEvidence };
  entry.note += ` 已补录并回读 ${records.length} 项${records.some(record=>record.expected.parameterKey==='cast_interval_ms')?'施放间隔或法力':'基础冷却或法力'}参数；不计为完整技能。`;
}
}
for (const candidateEvidence of ['技能公共参数实录/公共参数候选.json','技能公共参数第二批/公共参数候选.json','技能公共参数第三批/公共参数候选.json','技能公共参数第四批/公共参数候选.json','技能公共参数第五批/公共参数候选.json','技能公共参数第六批/公共参数候选.json','技能公共参数第七批/公共参数候选.json']) {
  for (const skipped of read(candidateEvidence).excludedSkillFields.filter(row=>row.status==='范围外跳过'&&!row.field)) {
    const entry=entries.find(row=>row.objectType==='技能'&&row.systemObjectKey===skipped.skillKey);
    assert.ok(entry, skipped.skillKey);
    entry.status='约定排除';
    entry.scopeDisposition={classification:'范围外技能',status:'范围外跳过',decision:skipped.reason,systemBlocking:false,evidence:candidateEvidence};
    entry.note=`主体及角色关联保留；${skipped.reason} 不计为待补机制或系统阻塞。`;
  }
}
for (const item of scopeItems) {
  const entry = entries.find(candidate => candidate.objectType === '技能' && candidate.systemObjectKey === item.skillKey);
  assert.ok(entry, `范围筛选技能未出现在录入进度：${item.skillKey}`);
  const disposition = item['处置'];
  const retainedComponents = (disposition['保留组成'] ?? []).map(component => component['组成']);
  const excludedComponents = (disposition['排除组成'] ?? []).map(component => component['组成']);
  entry.scopeDisposition = {
    classification: item['分类'],
    status: item['分类'] === '范围外技能' ? '范围外跳过' : '混合技能保留部分组成',
    decision: disposition['状态'],
    retainedComponents,
    excludedComponents,
    crossSkillDependency: disposition['跨技能依赖']?.['发现'] ?? null,
    systemBlocking: disposition['是否系统阻塞'] === true,
    evidence: scopeEvidence,
  };
  if (item['分类'] === '范围外技能') {
    entry.status = '约定排除';
    const exclusionReason = excludedComponents.length > 0 ? excludedComponents.join('、') : disposition['状态'];
    entry.note = `主体及角色关联已保留；一对一范围外：${exclusionReason}；不计为待补机制或系统阻塞。`;
  } else {
    entry.status = '部分录入';
    entry.note = `${entry.note} 一对一混合处置：${disposition['状态']}；本批只保留已列一对一组成，其他组成及运行接线另待补证。`;
  }
}
for (const skillKey of ['nasus_p', 'nasus_q', 'nasus_w', 'nasus_e', 'nasus_r']) {
  const entry = entries.find(candidate => candidate.objectType === '技能' && candidate.systemObjectKey === skillKey);
  assert.ok(entry, skillKey);
  const records = nasusMechanism.records.filter(record => record.skillKey === skillKey);
  entry.mechanismComponents = { evidence: nasusEvidence,
    counts: Object.fromEntries(['parameters', 'formulas', 'effects', 'processes'].map(type => [type, records.filter(record => record.type === type).length])) };
  entry.note += ` 内瑟斯机制批次另有 ${records.length} 个组成保存并回读；未完成项按该批清单继续。`;
  if (skillKey === 'nasus_p') {
    entry.status = '已录入';
    entry.initialization = {ruleKey:'initialize_lifesteal', evidence:nasusInitializationEvidence};
    entry.note = '当前1～18级范围：生命偷取等级参数、无限期自身属性效果、来源初始化规则均已保存并独立回读，规则由真实页面新增及关闭重开核对。配置录入已验收，战斗未执行。';
  }
}
for (const [batch,batchRelative] of [[heroSecond,heroSecondRelative],[heroThird,heroThirdRelative],[heroFourth,heroFourthRelative]]) {
for (const [skillKey, proof] of Object.entries(batch.skills)) {
  const entry = entries.find(candidate => candidate.objectType === '技能' && candidate.systemObjectKey === skillKey);
  assert.ok(entry, skillKey);
  entry.mechanismComponents = {counts:proof.counts, evidence:{worktree:luxEvidenceWorktree,relativePath:batchRelative}};
  entry.pendingMechanisms = proof.pending;
  entry.excludedMechanisms = proof.excluded;
  entry.note += ` 四英雄批次已保存 ${Object.values(proof.counts).reduce((a,b)=>a+b,0)} 个组成并独立回读；范围内待补与排除分别记录，不计为完整机制。`;
  if (skillKey==='tristana_q') {
    assert.deepEqual(proof.pending, []);
    assert.deepEqual(proof.excluded, []);
    assert.deepEqual(proof.counts, {parameters:4, formulas:0, effects:2, processes:1, internalStates:0, triggerRules:0});
    entry.status='已录入';
    entry.note='当前技能1～5级冷却、法力、7秒攻速加成及施放过程已保存；采用当前法力数组15/20/25/30/35，来源和全部7组成独立回读一致，批次代表页面已验收。配置录入完成，战斗未执行。';
  }
}
}
fs.writeFileSync(path.join(root, '英雄/录入进度.jsonl'), entries.map(x => JSON.stringify(x)).join('\n') + '\n');

const equipmentMechanismCounts = {
  skills: equipmentMechanism.records.length,
  parameters: equipmentMechanism.records.reduce((sum, record) => sum + record.parameterCount, 0),
  formulas: equipmentMechanism.records.reduce((sum, record) => sum + record.formulaCount, 0),
  effects: equipmentMechanism.records.filter(record => record.effect).length,
  triggerRules: equipmentMechanism.records.filter(record => record.rule).length,
  equipmentRelations: equipmentMechanism.records.filter(record => record.relation).length,
  representativeImageReuses: equipmentMechanism.records.filter(record => record.skillImage?.image?.enabled && record.skillImage.image.imageKey === record.itemKey).length,
};
const mechanismBatches = {
  equipmentEighthBatch: {
    skills:equipmentEighth.objects.map(record=>record.skillKey), parameters:41, formulas:6, effects:7, triggerRules:1,
    equipmentRelations:6, representativeImageReuses:6, modifierZonesAdded:2,
    status:'部分录入；26项纠错、独立GET与代表页面通过，持有者冷却、同次施法及合法触发等继续补录',
    runtimeValidation:'未执行', evidence:equipmentEighthEvidence, correctionEvidence:equipmentEighthCorrectionEvidence,
  },
  publicParametersSeventhBatch: {
    heroes:publicParametersSeventh.selectedHeroes, skills:publicParametersSeventh.counts.verifiedSkills,
    parameters:publicParametersSeventh.counts.verifiedParameters,
    status:'公共参数已保存并回读；8整槽排除、明确零值、组共享冷却及施放间隔分别记录，完整机制继续',
    runtimeValidation:'未执行', evidence:publicParameterSeventhEvidence,
  },
  publicParametersSixthBatch: {
    heroes:publicParametersSixth.selectedHeroes, skills:publicParametersSixth.counts.verifiedSkills,
    parameters:publicParametersSixth.counts.verifiedParameters,
    status:'公共参数已保存并回读，零费用与普通/弹药冷却区别已核，完整技能机制继续录入',
    runtimeValidation:'未执行', evidence:publicParameterSixthEvidence,
  },
  publicParametersFifthBatch: {
    heroes:publicParametersFifth.selectedHeroes, skills:publicParametersFifth.counts.verifiedSkills,
    parameters:publicParametersFifth.counts.verifiedParameters,
    status:'公共参数已保存并回读，7个范围外整槽已明确，完整技能机制继续录入',
    runtimeValidation:'未执行', evidence:publicParameterFifthEvidence,
  },
  equipmentNinthBatch: {
    skills:equipmentNinth.objects.map(record=>record.skillKey), parameters:27, formulas:8, effects:6, triggerRules:2,
    equipmentRelations:6, representativeImageReuses:6,
    status:'部分录入；属性基数和等级断点已补证，翠绿屏障初始化及成功消费已保存；其余按待配清单继续',
    runtimeValidation:'未执行', evidence:equipmentNinthEvidence,
  },
  equipmentEleventhBatch: {
    equipment: equipmentEleventh.objects.map(record=>record.equipmentKey),
    directAttributeAdded: { equipmentKey:'item_3009', attributeKey:'slow_resist_percent', value:0.25 },
    completeSkippedEffectEquipment: ['item_1120', 'item_3046', 'item_3085', 'item_3109'],
    newSkills:0, newTables:0,
    status:'当前1V1数据范围已处理；轻灵鞋常驻属性保存并页面核对，四件额外效果有排除依据',
    runtimeValidation:'未执行', evidence:equipmentEleventhEvidence,
  },
  heroFourthBatch: {
    skills:Object.keys(heroFourth.skills), ...heroFourth.totals,
    status:'部分录入；黛安娜攻速已纠正并页面核对，维迦E两项未保存草稿保留待修',
    executor:'Cursor路线中断后由执行代理接手，独立代理复核，主负责人真实页面验收',
    arithmeticCases:heroFourth.arithmeticCount, invariantChecks:heroFourth.invariantCount,
    runtimeValidation:'未执行', evidence:{worktree:luxEvidenceWorktree,relativePath:heroFourthRelative},
  },
  equipmentSeventhBatch: {
    skills:equipmentSeventh.objects.map(record=>record.skillKey), parameters:28, formulas:3, effects:6, processes:1, triggerRules:6,
    equipmentRelations:6, representativeImageReuses:6,
    status:'部分录入；十次成长与护盾消费已纠正，剩余冷却比例及合法事件接线待补',
    runtimeValidation:'未执行', evidence:equipmentSeventhEvidence,
  },
  publicParametersFourthBatch: {
    heroes:publicParametersFourth.selectedHeroes, skills:publicParametersFourth.counts.verifiedSkills,
    parameters:publicParametersFourth.counts.verifiedParameters,
    status:'公共参数已保存并回读，完整技能机制继续录入', runtimeValidation:'未执行', evidence:publicParameterFourthEvidence,
  },
  equipmentSixthBatch: {
    skills:equipmentSixth.objects.map(record=>record.skillKey), parameters:14, formulas:3, effects:6, triggerRules:3,
    equipmentRelations:6, representativeImageReuses:6,
    status:'部分录入；动态属性与按层值已纠正，收到护盾增幅、英雄击杀与同次施法筛选待补',
    runtimeValidation:'未执行', evidence:equipmentSixthEvidence,
  },
  heroThirdBatch: {
    skills:Object.keys(heroThird.skills), ...heroThird.totals, status:'部分录入，崔丝塔娜Q配置已齐，其余按待配清单推进',
    executor:'Cursor完成来源准备；连接重置后由执行代理接手API，主负责人页面试录希维尔E',
    arithmeticCases:heroThird.arithmetic.length, invariantChecks:heroThird.invariants.length,
    runtimeValidation:'未执行', evidence:{worktree:luxEvidenceWorktree,relativePath:heroThirdRelative},
  },
  publicParametersThirdBatch: {
    heroes:publicParametersThird.selectedHeroes, skills:publicParametersThird.counts.verifiedSkills,
    parameters:publicParametersThird.counts.verifiedParameters,
    status:'公共参数已保存并回读，完整技能机制继续录入', runtimeValidation:'未执行', evidence:publicParameterThirdEvidence,
  },
  equipmentFifthBatch: {
    skills:equipmentFifth.objects.map(record=>record.skillKey), parameters:9, formulas:0, effects:3, triggerRules:3,
    equipmentRelations:6, representativeImageReuses:6,
    status:'部分录入；重伤取强、控制强度与合法触发待迭代补录', runtimeValidation:'未执行', evidence:equipmentFifthEvidence,
  },
  equipmentFourthBatch: {
    skills:Object.keys(equipmentFourth.skills), parameters:9, formulas:3, effects:4, triggerRules:0,
    equipmentRelations:5, representativeImageReuses:5, directAttributeOnlySkipped:['item_3031'],
    status:'部分录入，阈值与来源纠错已回读，范围内待配继续', runtimeValidation:'未执行', evidence:equipmentFourthEvidence,
  },
  publicParametersSecondBatch: {
    heroes:publicParametersSecond.selectedHeroes, skills:publicParametersSecond.counts.verifiedSkills,
    parameters:publicParametersSecond.counts.verifiedParameters,
    status:'公共参数已保存并回读，完整技能机制继续录入', runtimeValidation:'未执行', evidence:publicParameterSecondEvidence,
  },
  equipmentThirdBatch: {
    skills:equipmentThird.records.map(record=>record.skillKey), parameters:41, formulas:8, effects:9, triggerRules:0,
    equipmentRelations:6, representativeImageReuses:6, directAttributesAdded:1,
    status:equipmentThird.status, runtimeValidation:equipmentThird.runtimeValidation, evidence:equipmentThirdEvidence,
  },
  heroSecondBatch: {
    skills:Object.keys(heroSecond.skills), ...heroSecond.totals, status:'部分录入',
    executor:heroSecond.executor, arithmeticCases:heroSecond.arithmetic, invariantChecks:heroSecond.invariants,
    runtimeValidation:'未执行', evidence:{worktree:luxEvidenceWorktree,relativePath:heroSecondRelative},
  },
  nasusInitialization: {
    skills:['nasus_p'], triggerRules:1, status:'当前1～18级范围被动配置已验收',
    runtimeValidation:'未执行', evidence:nasusInitializationEvidence,
  },
  equipmentSecondBatch: {
    skills: equipmentSecond.records.map(record => record.skillKey),
    parameters: equipmentSecond.counts.parameters,
    formulas: equipmentSecond.counts.formulas,
    effects: equipmentSecond.counts.effects,
    triggerRules: equipmentSecond.counts.triggerRules,
    equipmentRelations: equipmentSecond.counts.equipmentRelations,
    representativeImageReuses: equipmentSecond.counts.representativeImageReuses,
    status: equipmentSecond.status,
    runtimeValidation: equipmentSecond.runtimeValidation,
    evidence: equipmentSecondEvidence,
  },
  nasusFirstBatch: {
    skills: ['nasus_p', 'nasus_q', 'nasus_w', 'nasus_e', 'nasus_r'],
    ...nasusMechanism.counts,
    status: '部分录入，公共参数另列不重复计数',
    runtimeValidation: nasusMechanism.runtimeValidation,
    evidence: nasusEvidence,
  },
  publicParametersFirstBatch: {
    heroes: publicParameters.selectedHeroes,
    skills: publicParameters.counts.verifiedSkills,
    parameters: publicParameters.counts.verifiedParameters,
    status: '公共参数已保存并回读，完整技能机制继续录入',
    runtimeValidation: publicParameters.runtimeValidation,
    evidence: publicParameterEvidence,
  },
  asheWAndR: {
    skills: ['ashe_w', 'ashe_r'],
    parameters: asheMechanism.counts.parameters,
    formulas: asheMechanism.counts.formulas,
    effects: asheMechanism.counts.effects,
    status: asheMechanism.mechanismStatus,
    runtimeValidation: asheMechanism.runtimeStatus,
    evidence: '艾希技能实录第一批/独立核对.json',
  },
  luxFirstBatch: {
    skills: ['lux_p', 'lux_q', 'lux_w', 'lux_e', 'lux_r'],
    parameters: luxCounts.parameters,
    formulas: luxCounts.formulas,
    effects: luxCounts.effects,
    processes: luxCounts.processes,
    triggerRules: luxCounts.triggerRules,
    status: '部分录入',
    runtimeValidation: '未执行',
    evidence: { worktree: 'C:/project/damage_web_dev', relativePath: luxEvidenceRelative },
  },
  itemOnHit: {
    skills: ['item_3091_passive', 'item_3115_passive'],
    parameters: equipmentMechanismCounts.parameters,
    formulas: equipmentMechanismCounts.formulas,
    effects: equipmentMechanismCounts.effects,
    triggerRules: equipmentMechanismCounts.triggerRules,
    equipmentRelations: equipmentMechanismCounts.equipmentRelations,
    representativeImageReuses: equipmentMechanismCounts.representativeImageReuses,
    status: '部分录入',
    runtimeValidation: equipmentMechanism.runtime,
    evidence: '装备技能实录/Luna第一批/主负责人复核.json',
  },
  oneVOneScopeFiltering: {
    completeSkippedSkills: scopeSkippedKeys,
    mixedSkills: scopeMixedKeys,
    status: '范围已收窄；范围外跳过不计为待补机制或系统阻塞',
    evidence: scopeEvidence,
  },
};

const summary = {
  generatedAt: new Date().toISOString(), gameId: 'lol', sourceVersion: '16.17.1',
  evidence: '页面试录后，稳定流程改为接口录入；所有计数来自已保存的独立回读记录。',
  heroes: { count: 171, attributes: heroes.totals.sourceExplicitAttributes, levelValues: heroes.totals.sourceExplicitValues,
    sourceDifferences: 0, preexistingExtraAttributesPreserved: heroes.totals.extraConfiguredAttributeEntries,
    evidence: 'API实录/英雄全量核对/汇总.json', status: '主体及明确基础属性完成，完整角色仍为部分录入' },
  skills: { metadata: 855, characterRelations: 855, createdByApiThisStage: 835, previouslyAuthored: 20,
    evidence: 'API实录/技能/README.md', status: '基本资料和关联完成，完整技能数值及机制待逐项补录' },
  equipment: { count: 181, pureAttribute: 47, withEffects: 134, effectEquipmentDirectValues: 353,
    additionalDirectAttributes:2, additionalDirectAttributeEvidence:[equipmentThirdEvidence,equipmentEleventhEvidence],
    evidence: ['实录记录.json', 'API实录/装备/summary.json'], status: '主体与明确直接属性完成；已录装备技能组成见各批独立回读，完整触发与其余机制继续补录' },
  images: { objectUses: 1207, heroes: 171, skills: 855, equipment: 181,
    additionalEquipmentSkillRepresentativeReuses: equipmentMechanismCounts.representativeImageReuses + equipmentSecond.counts.representativeImageReuses + equipmentThird.counts.representativeImageReuses + equipmentFourth.summary.skillCount + equipmentFifth.objects.length + equipmentSixth.objects.length + equipmentSeventh.objects.length + equipmentEighth.objects.length + equipmentNinth.objects.length,
    additionalEquipmentSkillEvidence: ['装备技能实录/Luna第一批/主负责人复核.json', equipmentSecondEvidence, equipmentThirdEvidence, equipmentFourthEvidence, equipmentFifthEvidence, equipmentSixthEvidence, equipmentSeventhEvidence, equipmentEighthEvidence, equipmentNinthEvidence],
    status: '原1207个主体代表图历史证据保留；新增装备技能代表图九个已验收批次共49项复用另列，不宣称全部对象已整体重验',
    browserCacheRecords: 3202, browserReadFailures: 0,
    evidence: ['API实录/图片/full-relation-verification.json', 'API实录/装备图片/代表图关系最终核对.json', 'API实录/页面验收-2026-09-07.md'] },
  runes: { status: '资料已准备，缺少独立管理入口，尚未录入', evidence: '装备符文/符文待录清单.json' },
  deferred: ['斗魂竞技场海克斯', '海克斯大乱斗海克斯', '既定召唤与变形等机制排除项'],
  mechanismBatches,
  runtimeValidation: '未执行',
};
write('阶段进度.json', summary);
console.log(JSON.stringify({
  heroes: summary.heroes.count,
  skills: summary.skills.metadata,
  relations: summary.skills.characterRelations,
  equipment: summary.equipment.count,
  scopeSkipped: scopeSkippedKeys,
  scopeMixed: scopeMixedKeys,
  mechanismBatches: {
    ashe: [asheMechanism.counts.parameters, asheMechanism.counts.formulas, asheMechanism.counts.effects],
    lux: luxCounts,
    itemOnHit: equipmentMechanismCounts,
  },
}));
