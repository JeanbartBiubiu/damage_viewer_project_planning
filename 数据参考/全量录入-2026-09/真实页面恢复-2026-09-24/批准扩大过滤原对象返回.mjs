import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), prep = path.join(here, '普通伤害来源准备');
const read = file => JSON.parse(fs.readFileSync(path.join(prep, file), 'utf8'));
const plan = read('09-扩大过滤页面候选.json'), runtime = read('16-最终来源候选运行独立核对.json');
const sourceSha = '3199c6b831425b30b8c9e08ac075c27dc239a5d641fb9593cc731724c359ebe6';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash('C:/project/damage_web_dev/web/src/engine/ordinaryDamageSourceAudit.ts'), sourceSha);
assert.equal(runtime.runtimeScenes, 16); assert.equal(runtime.GETs, 72); assert.equal(runtime.businessWrites, 0);
assert(runtime.files.some(file => file.file === 'src/engine/ordinaryDamageSourceAudit.ts' && file.sha256 === sourceSha));
const log = fs.readFileSync(path.join(prep, '15-来源分类修复后前端检查.log'), 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
for (const step of ['lint', 'typecheck', 'test', 'build']) assert(log.includes(`STEP ${step} EXIT 0`));
assert(log.includes('1176 passed'));
const write = plan.writes[0];
const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + write.route, {
  method: 'GET', headers: { Authorization: 'Bearer ' + crypto.randomUUID() }, redirect: 'error', signal: AbortSignal.timeout(15000)
});
assert.equal(response.status, 200); assert.deepEqual(await response.json(), write.before);
const ledgerPath = path.join(here, '../阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const before = structuredClone(ledger), heroes = ledger.heroes.priorityScope.batches.flatMap(batch => batch.heroes);
assert.equal(heroes.length, 50);
for (const skill of ['annie_q', 'garen_r']) assert(heroes.some(hero => hero.skillKeys.includes(skill)));
for (const key of ['rune_8014', 'rune_8017']) assert(ledger.inventoryConclusions.runes.some(row => row.runeKey === key));
const proof = { at: new Date().toISOString(), status: 'FIRST_PAGE_UPDATE_APPROVED',
  model: 'gpt-6-sol', effort: 'max', sourceSha256: sourceSha,
  candidate: '普通伤害来源准备/09-扩大过滤页面候选.json', candidateSha256: hash(path.join(prep, '09-扩大过滤页面候选.json')),
  independentReview: { reviewer: 'damage_native_review', status: 'READY',
    verifiedFinalSourceSha256: sourceSha, auditAndInventoryTests: 46,
    fixedIssues: ['最终能力分类与作者重编结果完全一致', '角色本体命中来源不接受显式宠物或其他不符来源'],
    pageCandidateReview: '四笔前后差异与请求体、条件、金额、生命周期及引用核对通过' },
  finalRuntime: '普通伤害来源准备/16-最终来源候选运行独立核对.json', runtimeScenes: 16,
  frontendTests: 1176, lintTypecheckBuildPassed: true,
  approvedNow: { index: 1, method: write.method, route: write.route, body: write.body },
  subsequentUpdates: '第1笔真实页面保存重开并独立回读通过后再逐笔批准',
  heroScope: { count: 50, sourceSkillsInScope: ['annie_q', 'garen_r'], expanded: false },
  formalWritesByThisScript: 0, formalExpandedRuntimePassed: false, wholeRunesComplete: false
};
const evidence = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/61-来源审计验收与原对象页面批准.json';
Object.assign(ledger.mechanismBatches.conditionalDamageModifierReturn.sourceQualification, {
  status: 'READY_FOR_PAGE_RETURN', evidence, sourceAuditIndependentReview: 'READY',
  candidateRuntimeScenes: 16, finalFrontendTests: 1176, pageUpdateApprovedThrough: 1,
  pageUpdatesSaved: 0, independentlyVerifiedUpdates: 0, formalExpandedRuntimePassed: false
});
const check = structuredClone(ledger); check.mechanismBatches = before.mechanismBatches; assert.deepEqual(check, before);
const batches = structuredClone(ledger.mechanismBatches); batches.conditionalDamageModifierReturn = before.mechanismBatches.conditionalDamageModifierReturn;
assert.deepEqual(batches, before.mechanismBatches);
fs.writeFileSync(path.join(here, '61-来源审计验收与原对象页面批准.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, approvedStep: 1, runtimeScenes: 16, frontendTests: 1176, businessWrites: 0 }));
