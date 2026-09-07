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
const publicParameterEvidence = '技能公共参数实录/独立核对.json';
const publicParameters = read(publicParameterEvidence);
const nasusEvidence = '内瑟斯技能实录第一批/独立核对.json';
const nasusMechanism = read(nasusEvidence);
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
for (const skillKey of new Set(publicParameters.records.map(record => record.skillKey))) {
  const entry = entries.find(candidate => candidate.objectType === '技能' && candidate.systemObjectKey === skillKey);
  assert.ok(entry, skillKey);
  const records = publicParameters.records.filter(record => record.skillKey === skillKey);
  assert.ok(records.every(record => record.matches === true));
  entry.publicParameters = { keys: records.map(record => record.expected.parameterKey),
    checkedAt: records.at(-1).checkedAt, evidence: publicParameterEvidence };
  entry.note += ` 已补录并回读 ${records.length} 项基础冷却或法力参数；不计为完整技能。`;
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
  entry.note += ` 内瑟斯机制批次另有 ${records.length} 个组成保存并回读；控制、初始化或完整触发仍按该批清单继续。`;
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
    evidence: ['实录记录.json', 'API实录/装备/summary.json'], status: '主体与明确直接属性完成；两项普攻特效部分录入，其余机制继续补录' },
  images: { objectUses: 1207, heroes: 171, skills: 855, equipment: 181,
    additionalEquipmentSkillRepresentativeReuses: equipmentMechanismCounts.representativeImageReuses,
    additionalEquipmentSkillEvidence: '装备技能实录/Luna第一批/主负责人复核.json',
    status: '原 1207 个主体代表图历史证据保留；新增装备技能代表图复用 2 项另列，未将两者合并宣称为 1209 项整体重验',
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
