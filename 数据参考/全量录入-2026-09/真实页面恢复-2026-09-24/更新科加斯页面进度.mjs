import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const step = Number(process.argv[2]); assert([1, 2, 3].includes(step));
const rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const result = JSON.parse(fs.readFileSync(path.join(here, '科加斯击飞-03-独立回读-' + step + '.json'), 'utf8'));
assert.equal(result.status, 'PASS'); assert.equal(result.confirmedPageWrites, step);
const file = path.join(root, '数据参考/全量录入-2026-09/阶段进度.json');
const raw = fs.readFileSync(file, 'utf8'), j = JSON.parse(raw), old = structuredClone(j);
const entry = j.mechanismBatches.airborneStatusKindIncrement;
assert((entry.formalPageReturn?.confirmedPageWrites ?? 0) < step, '不得重复登记已有阶段');
entry.status = [null,
  '击飞目录已由Luna/max真实页面新增重开并独立回读；科加斯Q效果和入口继续顺序录入',
  '击飞目录与科加斯Q持续击飞效果已页面保存重开并独立回读，控制入口尚未保存',
  '击飞目录、科加斯Q持续效果及每目标一次控制入口已真实页面保存重开并独立回读；整技能与运行继续开放'][step];
entry.airborneBusinessRows = 1; entry.newKindPositiveHttp = true;
entry.formalPageReturn = {
  at: new Date().toISOString(), actualExecutor: 'gpt-6-luna/max', confirmedPageWrites: step,
  question: '独立击飞身份、无强度持续状态及每目标一次控制能否准确表达和保存',
  pagePlan: rel + '科加斯击飞-02-页面批准.json',
  readback: rel + '科加斯击飞-03-独立回读-' + step + '.json',
  independentGETsPerStep: 36, cumulativeIndependentGETs: step * 36,
  protectedResponses: result.protectedResponses, addedReferences: result.addedReferences.length,
  perTargetOnceIsIndependentOfDamage: true, runtimeValidated: false, wholeSkillComplete: false
};
entry.browser = step === 3;
entry.next = step === 1 ? '正常页面创建无强度击飞效果，独立回读后再接控制规则。' : step === 2 ? '正常页面创建明确未阻挡且同次每目标一次的独立控制规则。' : '核对落地减速和原伤害去重、吸血资格、完整施法链路，不重复已保存击飞控制。';
const row = j.inventoryConclusions.skills.find(x => x.skillKey === 'chogath_q');
if (step >= 2) {
  row.currentComponentCounts.effects = 3;
  row.currentComponentCounts.triggerRules = step === 3 ? 3 : 2;
  row.authoredKnockup = { effectKey: 'knockup', statusKey: 'airborne', durationParameter: 'knockup_duration_ms', durationMs: 1000,
    ruleKey: step === 3 ? 'actual_unblocked_knockup' : null, pageSaved: true, pageReopened: true,
    httpReadback: 'PASS', oncePerUseScope: step === 3 ? 'TARGET' : null, runtimeValidated: false,
    evidence: entry.formalPageReturn.readback };
  row.reason = step === 2 ? '既有普通使用与明确未阻挡伤害保持；1秒无强度击飞效果和目录已页面保存重开并独立核对，控制规则继续录入。原伤害去重、吸血资格、减速及完整时序未完成。' : '既有普通使用与伤害保持；1秒独立击飞目录、持续效果和明确未阻挡敌方英雄的每目标一次控制规则均页面保存重开并独立回读，新增5条引用。原伤害去重/吸血资格、落地减速及完整时序继续开放，不计整技能完成。';
}
if (step === 3) {
  row.completedBranches ??= [];
  row.completedBranches.push('独立击飞状态与1000毫秒无强度持续效果；明确未阻挡敌方英雄按同次使用每目标一次施加，真实页面与独立回读通过');
  row.remainingBranches = row.remainingBranches.map(x => x === '击飞和减速' ? '落地后减速；复杂来源控制叠加及免疫/解除交互另行核定' : x);
}
for (const [k, v] of Object.entries(old.mechanismBatches)) if (k !== 'airborneStatusKindIncrement') assert.deepEqual(j.mechanismBatches[k], v);
for (const [i, v] of old.inventoryConclusions.skills.entries()) if (v.skillKey !== 'chogath_q') assert.deepEqual(j.inventoryConclusions.skills[i], v);
for (const k of Object.keys(old)) if (!['mechanismBatches', 'inventoryConclusions'].includes(k)) assert.deepEqual(j[k], old[k]);
for (const k of Object.keys(old.inventoryConclusions)) if (k !== 'skills') assert.deepEqual(j.inventoryConclusions[k], old.inventoryConclusions[k]);
assert.equal(fs.readFileSync(file, 'utf8'), raw, '账本被其他任务修改');
fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', step, coverageUnchanged: true, changedSkill: step >= 2 ? 'chogath_q' : null, businessWrites: 0 }));
