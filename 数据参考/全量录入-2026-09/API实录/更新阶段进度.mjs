import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data, null, 2) + '\n');
const heroes = read('API实录/英雄全量核对/汇总.json');
const skills = read('API实录/技能/summary.json');
const skillPlan = read('英雄技能全量页面输入/skills-basic-plan.json').skills;
const equipment = read('API实录/装备/summary.json');
const pureEquipment = read('实录记录.json');
const heroSkillImages = read('API实录/图片/full-relation-verification.json');
const equipmentImages = read('API实录/装备图片/代表图关系最终核对.json');
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
fs.writeFileSync(path.join(root, '英雄/录入进度.jsonl'), entries.map(x => JSON.stringify(x)).join('\n') + '\n');

const summary = {
  generatedAt: new Date().toISOString(), gameId: 'lol', sourceVersion: '16.17.1',
  evidence: '页面试录后，稳定流程改为接口录入；所有计数来自已保存的独立回读记录。',
  heroes: { count: 171, attributes: heroes.totals.sourceExplicitAttributes, levelValues: heroes.totals.sourceExplicitValues,
    sourceDifferences: 0, preexistingExtraAttributesPreserved: heroes.totals.extraConfiguredAttributeEntries,
    evidence: 'API实录/英雄全量核对/汇总.json', status: '主体及明确基础属性完成，完整角色仍为部分录入' },
  skills: { metadata: 855, characterRelations: 855, createdByApiThisStage: 835, previouslyAuthored: 20,
    evidence: 'API实录/技能/README.md', status: '基本资料和关联完成，完整技能数值及机制待逐项补录' },
  equipment: { count: 181, pureAttribute: 47, withEffects: 134, effectEquipmentDirectValues: 353,
    evidence: ['实录记录.json', 'API实录/装备/summary.json'], status: '主体与明确直接属性完成，主动被动效果尚待配置' },
  images: { objectUses: 1207, heroes: 171, skills: 855, equipment: 181,
    status: '代表图关系与内容核对完成；页面同步后全部正式对象缩略图加载成功',
    browserCacheRecords: 3202, browserReadFailures: 0,
    evidence: ['API实录/图片/full-relation-verification.json', 'API实录/装备图片/代表图关系最终核对.json', 'API实录/页面验收-2026-09-07.md'] },
  runes: { status: '资料已准备，缺少独立管理入口，尚未录入', evidence: '装备符文/符文待录清单.json' },
  deferred: ['斗魂竞技场海克斯', '海克斯大乱斗海克斯', '既定召唤与变形等机制排除项'],
  runtimeValidation: '未执行',
};
write('阶段进度.json', summary);
console.log(JSON.stringify({ heroes: summary.heroes.count, skills: summary.skills.metadata, relations: summary.skills.characterRelations, equipment: summary.equipment.count }));
