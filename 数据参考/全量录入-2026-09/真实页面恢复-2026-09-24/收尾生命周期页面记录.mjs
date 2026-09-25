import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..'), relative = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const read = n => JSON.parse(fs.readFileSync(path.join(here, n), 'utf8'));
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const write = (n, v) => fs.writeFileSync(path.join(here, n), JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const beforeCode = read('36-零结果录入检查修复检查点.json');
for (const [f, h] of Object.entries(beforeCode.sourceHashes)) assert.equal(hash(path.join('C:/project/damage_backend_dev', f)), h);
let preservedDirty = 0;
for (const f of read('00-恢复核对.json').initialDirty.filter(x => !x.path.startsWith('文档记录/'))) {
  assert.equal(hash(path.join(root, f.path)), f.sha256, '其他任务文件变化：' + f.path); preservedDirty++;
}
const browser = read('执行代理/luna_sivir/07-希维尔录入检查修复后复验.json');
assert.equal(browser.result.structure, 'NO_ERRORS'); assert.equal(browser.result.reviewCount, 2);
assert.equal(browser.noWrite.businessWritesDuringThisVerification, 0);
const proofYi = read('38-易大师延长组成真实页面验收.json');
assert.equal(proofYi.status, 'PASS_MANAGEMENT_COMPONENT');
const currentReads = [], token = crypto.randomUUID();
for (const [key, file] of [['sivir', '希维尔标记-03-独立回读.json'], ['masteryi', '易大师延长-03-独立回读.json']]) {
  const route = '/characters/champion_' + key + '/authoring-check';
  const res = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(res.status, 200);
  const current = await res.json(), old = read(file).values[route];
  const { checkedAt: a, ...c } = current, { checkedAt: b, ...o } = old;
  assert.deepEqual(c, o, '独立返回后的结构发生变化：' + key);
  currentReads.push({ method: 'GET', route, status: 200, body: current });
}
write('39-零结果录入检查原对象闭环.json', {
  at: new Date().toISOString(), status: 'PASS_ORIGINAL_AND_PEER_RETURN',
  question: '合法生命周期标记能否同时通过保存与录入检查，并保留引用和未接线提示',
  problem: '希维尔recent_damage_mark正常保存201并重开，但角色录入检查仍无条件要求results非空',
  correction: '只调整后端角色检查的结果非空条件，与既有保存契约一致；不修改业务数据或SQL',
  originalEvidence: '35-希维尔空结果保存后录入检查.json', codeEvidence: '36-零结果录入检查修复检查点.json',
  serviceEvidence: '37-零结果检查修复真实服务核验.json', originalPage: '执行代理/luna_sivir/07-希维尔录入检查修复后复验.json',
  peerPage: proofYi.checkEvidence, peerEvidence: '38-易大师延长组成真实页面验收.json',
  originalExecutor: 'gpt-6-luna/max', peerExecutor: 'gpt-6-sol/max',
  originalSaveAndReopen: true, replayedBusinessWrites: 0, removedFalseErrors: 1, remainingReviews: 2,
  originalIndependentGETs: 26, protectedResponses: 23, totalCharacterReferences: 83,
  lifecycleParameterReferencePreserved: true, targetedTests: 87, backendFullTests: 1264, finalCodeHashesVerified: true,
  finalCheckReads: currentReads, unrelatedDirtyFilesPreserved: preservedDirty,
  runtimeValidated: false, wholeSkillComplete: false
});
const ledgerFile = path.join(root, '数据参考/全量录入-2026-09/阶段进度.json');
const raw = fs.readFileSync(ledgerFile, 'utf8'), ledger = JSON.parse(raw), original = structuredClone(ledger);
const sivir = ledger.mechanismBatches.sivirRRefreshComponentReturn;
sivir.status = '最近伤害零结果标记真实页面保存重开和26项独立回读通过；角色检查误报已最小修复，原对象与易大师普通结果同类返回均通过，完整入口继续开放';
sivir.browser = { verified: true, reason: 'Luna正常页面保存重开标记，查看既有刷新效果，并返回原角色检查；结构错误0，保留2项未接线提示和83条引用', evidence: relative + '39-零结果录入检查原对象闭环.json' };
sivir.remaining = sivir.remaining.filter(x => !x.includes('首次真实页面保存最近伤害标记') && !x.includes('已保存刷新辅助效果的代表页面验收'));
sivir.boundary = sivir.boundary.map(x => x.includes('首次业务返回仍待真实页面') ? '过程重复启动的完整约定继续独立核对；仅生命周期标记及既有刷新效果已完成正式页面返回，未接完整伤害和击杀入口。' : x);
sivir.next = '核定最近伤害资格、死亡清理和参与击杀接线及普通R入口，不重复已保存标记或辅助效果。';
Object.assign(sivir.lifecycleOnlyIncrement, { status: '正式页面保存重开、独立回读及角色检查修复原对象返回通过', bodyReadback: relative + '希维尔标记-03-独立回读.json', closureEvidence: relative + '39-零结果录入检查原对象闭环.json' });
Object.assign(sivir.lifecycleOnlyIncrement.diagnosticFix, { liveReturn: true, originalStructure: 'NO_ERRORS', unconnectedReviewsPreserved: 2, markerReferencePreserved: true, peer: 'masteryi_r', closureEvidence: relative + '39-零结果录入检查原对象闭环.json' });
const yi = ledger.mechanismBatches.masterYiRDurationExtensionAudit;
yi.status = '延长辅助效果正式页面保存重开与独立回读通过；触发、暂停和免疫等分支继续开放';
yi.browserBlocker = null;
yi.next = '核定参与击杀接线、学习门槛、主动窗口、封顶和临界时序，减速免疫及Q/W暂停继续独立处理。';
yi.formalPageReturn = { evidence: relative + '38-易大师延长组成真实页面验收.json', actualExecutor: 'gpt-6-sol/max', confirmedPageWrites: 1, pageReopened: true, independentGETs: 32, protectedResponses: 29, oldReferencesPreserved: 19, addedReferences: 4, runtimeValidated: false, wholeSkillComplete: false };
Object.assign(yi.pageReturnPreparation, { status: '已由主负责人明确改派获授权Sol/max完成唯一页面新增；冻结业务正文不变', confirmedPageWrites: 1, result: relative + '38-易大师延长组成真实页面验收.json' });
const srow = ledger.inventoryConclusions.skills.find(x => x.skillKey === 'sivir_r');
srow.reason = '最近伤害资格标记已正常页面保存、重开并独立核对；角色检查空结果误报已修复并返回，生命周期引用和未接线提示保持。伤害资格、死亡清理、参与击杀接线及普通R入口继续开放，整技能未完成。';
srow.completedBranches = srow.completedBranches.map(x => x.includes('独立生命周期刷新辅助效果') ? '独立生命周期刷新辅助效果（既有保存、独立回读及代表页面查看通过，未接触发）' : x);
srow.completedBranches.push('合法空结果标记的角色录入检查修复，原对象与普通有结果对象真实页面返回通过');
srow.remainingBranches = [...sivir.remaining];
srow.remainingBranchesBoundary = '按当前未完成分支列举；标记和辅助效果的管理返回不等于完整技能入口或运行完成。';
srow.pageReturnEvidence = relative + '39-零结果录入检查原对象闭环.json';
const yrow = ledger.inventoryConclusions.skills.find(x => x.skillKey === 'masteryi_r');
yrow.reason = '70%剩余冷却效果保持；主动7秒剩余时长延长辅助效果已由Sol页面保存重开，32次独立GET与29项保护通过，新增4条引用。学习门槛、减速免疫、Q/W暂停及参与击杀接线仍开放，整技能未完成。';
yrow.currentComponentCounts = { parameters: 8, formulas: 0, effects: 5, processes: 0, internalStates: 0, triggerRules: 1 };
yrow.completedBranches.push('现有攻速和移速生命周期各延长7000毫秒的辅助效果，真实页面保存重开和独立回读通过，未接触发');
yrow.pageReturnEvidence = relative + '38-易大师延长组成真实页面验收.json';
const changedKeys = new Set(['sivirRRefreshComponentReturn', 'masterYiRDurationExtensionAudit']);
for (const [k, v] of Object.entries(original.mechanismBatches)) if (!changedKeys.has(k)) assert.deepEqual(ledger.mechanismBatches[k], v);
for (const [i, row] of original.inventoryConclusions.skills.entries()) if (!['sivir_r', 'masteryi_r'].includes(row.skillKey)) assert.deepEqual(ledger.inventoryConclusions.skills[i], row);
for (const k of Object.keys(original)) if (!['mechanismBatches', 'inventoryConclusions'].includes(k)) assert.deepEqual(ledger[k], original[k]);
for (const k of Object.keys(original.inventoryConclusions)) if (k !== 'skills') assert.deepEqual(ledger.inventoryConclusions[k], original.inventoryConclusions[k]);
assert.equal(fs.readFileSync(ledgerFile, 'utf8'), raw, '账本并发修改');
fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', closure: '39', finalGETs: 2, unrelatedDirtyFilesPreserved: preservedDirty, changedObjectRows: ['sivir_r', 'masteryi_r'], coverageUnchanged: true, businessWrites: 0 }));
