import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const prep = path.join(here, '普通伤害来源准备');
const read = file => JSON.parse(fs.readFileSync(path.join(prep, file), 'utf8'));
const catalogBytes = fs.readFileSync(path.join(prep, '02-已核定普通伤害来源目录.json'));
const catalog = JSON.parse(catalogBytes), basis = read('03-来源核定依据.json'), host = read('宿主现值核验/适配结果.json');
const sha = crypto.createHash('sha256').update(catalogBytes).digest('hex');
assert.equal(sha, basis.catalogSha256);
assert.deepEqual(catalog.reviews.map(x => x.skillKey).sort(), ['annie_q', 'garen_r']);
assert.equal(host.sourceSnapshot.sha256Before, host.sourceSnapshot.sha256After);
const attack = host.results.find(x => x.skillKey === 'shared_basic_attack');
assert.equal(attack.actual.ok, false);
assert(attack.actual.error.path.endsWith('.detail.critical'));
assert(JSON.stringify(attack.diagnosticOrderProbe).includes('未支持的命中结果'));
for (const key of ['annie_q', 'garen_r']) assert.equal(host.results.find(x => x.skillKey === key).actual.ok, true);
const proof = {
  at: new Date().toISOString(), status: 'IMPLEMENTING_SOURCE_AUDIT', businessWrites: 0,
  question: '符文放宽伤害过滤前，能否核定真实伤害来源并覆盖最终全部产伤路径，拒绝未核准的特殊来源',
  catalog: '普通伤害来源准备/02-已核定普通伤害来源目录.json', catalogSha256: sha,
  reviewedSources: catalog.reviews.map(({ reviewKey, characterKey, skillKey, ruleKey, actionKey, effectKey, resultKey, damageTypeKey }) =>
    ({ reviewKey, characterKey, skillKey, ruleKey, actionKey, effectKey, resultKey, damageTypeKey })),
  hostEvidence: '普通伤害来源准备/宿主现值核验/适配结果.json',
  hostActualResults: host.results.map(x => ({ skillKey: x.skillKey, adapterPassed: x.actual.ok, error: x.actual.error ?? null })),
  sharedAttackGap: {
    actualObject: 'shared_basic_attack/attack_hit', firstRejection: attack.actual.error,
    secondRejection: attack.diagnosticOrderProbe,
    reproduced: true, expected: '完整命中伤害保留来源暴击与并列命中关联后进入通用运行',
    impact: '共享普攻正式组成及依赖其完整伤害和附带命中的来源；安妮Q和盖伦R不受此拒绝影响',
    localBlocker: true, globalBlocker: false, dataPreserved: true,
    repairPending: true
  },
  inventoryComponent: { targetedTests: 19, independentReview: 'READY', integrated: false },
  sourceAuditComponent: { implementationPending: true, independentFinalReviewPending: true },
  runtimeCasesPrepared: 4, runtimeCasesExecuted: 0, expandedRunePageWrites: 0,
  existingTwoRuneBoundedReturn: '57-两符文门槛原对象同类与正式运行验收.json',
  existingDraftReturn: '58-符文安全草稿返回独立验收.json',
  wholeRunesComplete: false, coverageChanged: false
};
const ledgerPath = path.join(here, '..', '阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const before = structuredClone(ledger), batch = ledger.mechanismBatches.conditionalDamageModifierReturn;
assert.equal(batch.additionalDraftReturnPending, false);
batch.sourceQualification = {
  status: proof.status, evidence: '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/59-普通来源核定与宿主缺口.json',
  reviewedSourceSkills: ['annie_q', 'garen_r'], expandedRunePageWrites: 0, formalExpandedRuntimePassed: false,
  sharedBasicAttackAdapterGaps: ['SOURCE_CRIT_CHANCE', 'HIT_LINK_APPLICATION']
};
const check = structuredClone(ledger);
check.mechanismBatches.conditionalDamageModifierReturn = before.mechanismBatches.conditionalDamageModifierReturn;
assert.deepEqual(check, before);
fs.writeFileSync(path.join(here, '59-普通来源核定与宿主缺口.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, approvedSources: 2, actualAdapterRejections: 2, businessWrites: 0, coverageChanged: false }));
