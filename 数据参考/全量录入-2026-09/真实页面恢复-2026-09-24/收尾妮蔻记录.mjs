import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 仅更新本任务文档与逐对象账本；本脚本没有网络或业务写入。
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const read = p => JSON.parse(fs.readFileSync(path.join(here, p), 'utf8'));
const back = read('04-本批独立回读.json');
assert.equal(back.status, 'PASS');
assert.equal(back.audit.length, 43);
assert.equal(back.protectedResponses, 36);
const approved = read('02-批准范围.json');
for (const [file, i] of [['01-效果页面请求.json', 1], ['02-规则页面请求.json', 2]]) {
  const evidence = read('执行代理/sol_neeko/' + file);
  const req = Array.isArray(evidence) ? evidence[0] : evidence;
  assert.equal(req.status, 201);
  assert.deepEqual(req.body, approved.allowedRequests[i].body);
}
const progressFile = path.join(root, '数据参考/全量录入-2026-09/阶段进度.json');
const originalText = fs.readFileSync(progressFile, 'utf8');
const before = JSON.parse(originalText), next = structuredClone(before);
const batch = next.mechanismBatches.realPageRecoveryFirst;
assert.equal(batch.pageWritesConfirmed, 3);
const now = new Date().toISOString();
next.generatedAt = now;
Object.assign(batch, {
  at: now, status: '凯旋原对象与妮蔻同类总览返回通过；妮蔻首次接触禁锢效果及五条件规则已页面保存并独立回读',
  pageWritesConfirmed: 4, pending: [],
  independentReadback: { ...batch.independentReadback, finalGETs: 43, finalProtectedResponses: 36, evidence: rel + '04-本批独立回读.json' },
  pageProof: rel + '执行代理/sol_neeko/03-妮蔻页面执行记录.md',
  newlyObservedBurden: '新规则未保存的默认条件cond_1及动作action_1在子编辑器中标识只读，命名需删除重建草稿；继续独立调查，未阻塞本批保存'
});
batch.confirmedRoutes.push('/skills/neeko_e/trigger-rules/apply_root_on_first_contact');
batch.systemFix.peerPageReturn = true;
batch.systemFix.peerEvidence = rel + '执行代理/sol_neeko/03-妮蔻页面执行记录.md';
const neeko = next.inventoryConclusions.skills.find(x => x.skillKey === 'neeko_e');
assert(neeko && !neeko.managementComplete);
neeko.currentComponentCounts.triggerRules = 3;
neeko.reason = '本体伤害与普通使用已保存；首次接触最短禁锢及五条件规则通过Sol真实页面保存、关闭重开和独立回读。首次接触、敌方英雄、同次未被法术护盾阻挡及无本来源实例可组合；后续强化和已有实例重施仍未完成，不计整技能管理完整。';
neeko.remainingBranches = ['后续接触的强化资格、阻挡与缺值分支、已有实例重施', '原伤害与普通使用组成的代表页面验收及必要运行验证'];
neeko.completedBranches.push('首次接触最短禁锢：五条件单动作真实页面保存、关闭重开与独立回读');
neeko.currentPageReturn = {
  batchKey: 'realPageRecoveryFirst', actor: 'gpt-6-sol/max',
  firstContactEffect: '已页面保存、关闭重开并独立回读', firstContactRule: '已页面保存、关闭重开并独立回读',
  behaviorOverview: '规则说明、动作目标上下文和效果实际对象同类返回通过',
  evidence: rel + '04-本批独立回读.json', pageEvidence: batch.pageProof,
  runtimeValidated: false
};
const step = next.mechanismBatches.singleStepAuthoringReturn;
step.authoritativePlan = '文档记录/详细设计/项目/管理页面与共性机制迭代计划.md';
step.planSection = '真实页面恢复返回：强化步骤的单一结算来源（2026-09-24）';
step.status = '宿主修订与独立复核通过；已委派原Sol/max执行代理办理夺萃原对象六笔正常页面返回';
assert.deepEqual(next.coverage, before.coverage);
for (const [k, v] of Object.entries(before)) if (!['generatedAt', 'mechanismBatches', 'inventoryConclusions'].includes(k)) assert.deepEqual(next[k], v);
assert.deepEqual(next.inventoryConclusions.skills.filter(x => x.skillKey !== 'neeko_e'), before.inventoryConclusions.skills.filter(x => x.skillKey !== 'neeko_e'));
for (const [k,v] of Object.entries(before.inventoryConclusions)) if (k !== 'skills') assert.deepEqual(next.inventoryConclusions[k],v);
for (const [k,v] of Object.entries(before.mechanismBatches)) if (!['realPageRecoveryFirst','singleStepAuthoringReturn'].includes(k)) assert.deepEqual(next.mechanismBatches[k],v);
assert.equal(fs.readFileSync(progressFile, 'utf8'), originalText, '期间账本已改变，停止覆盖');
fs.writeFileSync(progressFile, JSON.stringify(next, null, 2) + '\n');
const record = {
  at: now, previousGoalTurn: 'no progress: 上轮只回答提示词修订；本轮恢复正式数据独立核对并继续页面批次',
  status: 'PASS', question: '首次目标接触能否与敌方英雄、同次未阻挡和无本来源实例组合；总览能否区分动作与结果目标',
  actor: 'gpt-6-sol/max', modelProof: rel + '09-妮蔻执行模型交接.json',
  pageWrites: 2, independentGETs: 43, protectedResponses: 36,
  pageReopen: true, ownerInspectedThreeOverviewScreenshots: true, overviewOriginalAndPeerReturn: true,
  readbackNormalization: {
    observed: 'SKILL_HIT详情返回额外useKind:null，既有actual_hit亦如此；没有业务数据变化',
    codeEvidence: 'server/data_manage/src/main/java/xyz/game/datamanage/model/skilltrigger/SkillTriggerSkillEventDetail.java:12-18；SkillTriggerEventSourceDeserializer.java:24',
    correction: '只给期望GET明细补已证实的useKind:null；批准POST正文不改，不忽略其他字段，完整正文严格比较通过',
    businessReplay: false
  },
  wholeSkillComplete: false, runtimeValidated: false,
  next: '夺萃六笔页面返回；默认草稿子标识只读负担的有界调查',
  progressBeforeSha256: crypto.createHash('sha256').update(originalText).digest('hex'),
  progressAfterSha256: crypto.createHash('sha256').update(fs.readFileSync(progressFile)).digest('hex')
};
fs.writeFileSync(path.join(here, '17-妮蔻与总览返回验收.json'), JSON.stringify(record, null, 2) + '\n', {flag:'wx'});
console.log(JSON.stringify({status:'RECORDED', coverageChanged:false, neekoWholeSkillComplete:false, pageWrites:4}));
