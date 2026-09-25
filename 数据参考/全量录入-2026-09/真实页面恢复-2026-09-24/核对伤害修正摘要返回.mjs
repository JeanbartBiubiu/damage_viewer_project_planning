import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pageEvidence = '执行代理/sol_rune_health_gate/75-两符文摘要修复原对象零写返回.json';
const page = read(pageEvidence);
const baseline = read('普通伤害来源准备/11-扩大过滤独立回读-4.json');
assert.equal(page.guard.businessWrites, 0);
assert.equal(page.guard.blockedNonGet.length, 0);
assert.equal(page.finalDialogs, 0);
assert.equal(page.temporaryDraft.parentSaveClicked, false);
assert.equal(page.temporaryDraft.confirmedChildIntoParent, true);
assert.deepEqual(page.temporaryDraft.normalControlChanges, {
  damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', criticalFilter: 'CRITICAL_ONLY'
});
assert.deepEqual(page.temporaryDraft.afterReopen, {
  damageTypeKey: null, deliveryKind: 'ANY', criticalFilter: 'ANY', conditionComparator: 'LT',
  thresholdParameter: 'target_health_threshold_ratio', amountParameter: 'bonus_damage_ratio'
});
assert.deepEqual(page.temporaryDraft.discardDialogs, [{ type: 'confirm', message: '当前修改尚未保存，确定要离开吗？' }]);
for (const [key, comparison] of [['rune8014', '严格低于'], ['rune8017', '严格高于']]) {
  const summary = page.savedSummary[key];
  for (const field of ['parentSpecial', 'overviewEffect']) {
    for (const text of ['伤害类型：全部', '产生方式：全部', '来源性质：直接伤害', '暴击筛选：全部', comparison, 'target_health_threshold_ratio']) {
      assert(summary[field].includes(text), key + '/' + field + '/' + text);
    }
  }
  assert.equal(summary.amount, 'bonus_damage_ratio');
  assert.equal(summary.target, '效果施法者，动作当前目标');
}
const files = {
  'effects/resultReferenceSummary.ts': '932d06a655fa64ab50b11f78a60a5d76c6d2bc6b87bdeb562e6ca71ad6f986d7',
  'effects/resultReferenceSummary.test.ts': '6869cf993ca83ff6aaf74512cae86f7b4ec0cff2efd8196322bb4ba63648cc66',
  'effects/SkillEffectEditorModal.tsx': 'afb4aaf1955d8746df36b20b64644d8e65fa4225c7e5724085386fd02b4c682c',
  'overview/skillBehaviorOverview.ts': 'a3370a2cd0c00dc0a2a85d1af533b887d897ac26a93790093db6a02fe7a35251',
  'overview/skillBehaviorOverview.test.ts': '6c819dd3eacca67c41053ed23e0312190c397e4a32c2433c00425553a8fb0d5f'
};
for (const [file, expected] of Object.entries(files)) {
  assert.equal(sha(path.join('C:/project/damage_web_dev/web/src/pages/admin/skills', file)), expected, file);
}
assert.equal(sha(path.join(here, '页面摘要修复证据/验收记录.md')), '98e8e028d6516a496f24a3ada6e4f2c6d9a41c8c7aa0080c02af65fd90a51a8d');
const protectedFiles = read('00-恢复核对.json').initialDirty.filter(item => !item.path.startsWith('文档记录/'));
assert.equal(protectedFiles.length, 15);
for (const item of protectedFiles) assert.equal(sha(path.join(root, item.path)), item.sha256, item.path);
const screenshots = page.screenshots.map(file => ({ file, sha256: sha(path.join(here, '执行代理/sol_rune_health_gate', file)) }));
const values = {}, audit = [], token = crypto.randomUUID();
for (const [route, expected] of Object.entries(baseline.values)) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, route);
  values[route] = await response.json();
  assert.deepEqual(values[route], expected, route + ' 含时间戳应保持');
  audit.push({ method: 'GET', route, status: response.status, unchanged: true });
}
assert.equal(audit.length, 38);
const filename = '67-两符文摘要原对象同类返回独立验收.json';
const evidence = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/' + filename;
const proof = {
  at: new Date().toISOString(), actualExecutor: { model: 'gpt-6-sol', effort: 'max',
    existingVerification: '09-妮蔻执行模型交接.json', actualAgentId: '01a0d0f9-2c94-7a63-aacc-71f38f80049e' },
  pageEvidence, pageBusinessWrites: 0, pageNonGETAttempts: 0, finalDialogs: 0,
  originalAndPeerPassed: true, savedStructuredSummaryPassed: true, temporaryDraftDiscardPassed: true,
  independentGETs: audit.length, unchangedIncludingTimestamps: true,
  sourceFilesSha256: files, targetedTests: 20, frontendTests: 1179,
  checks: ['typecheck', 'lint', 'test', 'build', 'diff --check'],
  codeReview: '主负责人核对本次纯摘要变化，未新增请求、保存字段或草稿修改路径；最终五文件摘要与通过检查的版本一致',
  protectedUnrelatedDirtyFiles: 15, nonBlockingObservation: page.observation,
  observationDisposition: '当前摘要无伤害类型名称目录，具体类型保留稳定键回退；记录可读性不足，本轮不新增请求，不阻塞原摘要遗漏修复验收',
  wholeRunesComplete: false, screenshots, audit, values
};
const ledgerPath = path.join(here, '../阶段进度.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')), before = structuredClone(ledger);
const phase = ledger.mechanismBatches.conditionalDamageModifierReturn.sourceQualification;
assert.equal(phase.presentationReturnPending, true);
phase.presentationReturnPending = false;
phase.presentationReturn = { status: 'PASSED', evidence, pageBusinessWrites: 0, independentGETs: 38,
  originalAndPeerPassed: true, draftDiscardPassed: true, persistedDataUnchanged: true,
  nonBlockingObservation: '具体伤害类型摘要保留稳定键，中文名称回退改进尚未实施' };
for (const key of ['rune_8014', 'rune_8017']) {
  const row = ledger.inventoryConclusions.runes.find(item => item.runeKey === key);
  assert(row); assert.equal(row.realPageRecovery.sourceScopeReturn.presentationReturnPending, true);
  row.realPageRecovery.sourceScopeReturn.presentationReturnPending = false;
  row.realPageRecovery.sourceScopeReturn.presentationEvidence = evidence;
}
const check = structuredClone(ledger);
check.mechanismBatches = before.mechanismBatches;
check.inventoryConclusions.runes = before.inventoryConclusions.runes;
assert.deepEqual(check, before);
assert.deepEqual(ledger.inventoryConclusions.runes.filter(item => !['rune_8014', 'rune_8017'].includes(item.runeKey)),
  before.inventoryConclusions.runes.filter(item => !['rune_8014', 'rune_8017'].includes(item.runeKey)));
fs.writeFileSync(path.join(here, filename), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ originalAndPeerPassed: true, pageBusinessWrites: 0, independentGETs: 38, allUnchanged: true, unrelatedDirtyPreserved: 15 }));
