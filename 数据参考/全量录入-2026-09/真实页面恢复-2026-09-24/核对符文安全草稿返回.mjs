import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const previous = read('符文生命门槛准备/11-页面独立回读-6.json');
const page = read('执行代理/sol_rune_health_gate/42-致命一击原对象安全草稿返回.json');
assert.equal(page.after.nonGetRequests, 0);
assert.equal(page.guard.blockedNonGet.length, 0);
assert.equal(page.formulaPreflight.getObserved, true);
assert.equal(page.formulaPreflight.draftRetained, true);
assert.equal(page.formulaPreflight.saveRequestCount, 0);
assert.equal(page.unsavedResultCleanup.cancelKept, true);
assert.equal(page.unsavedResultCleanup.conditionRemovedAfterConfirm, true);
assert.equal(page.unsavedResultCleanup.parentResultCountAfterDiscard, 1);
assert.equal(page.after.visibleDialogs, 0);
const values = {}, audit = [], token = crypto.randomUUID();
for (const [route, expected] of Object.entries(previous.values)) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, route);
  values[route] = await response.json();
  assert.deepEqual(values[route], expected, `${route} 含时间戳的完整现值应不变`);
  audit.push({ method: 'GET', route, status: response.status, unchanged: true });
}
assert.equal(audit.length, 38);
const evidence = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/58-符文安全草稿返回独立验收.json';
const proof = {
  at: new Date().toISOString(), actualExecutor: { model: 'gpt-6-sol', effort: 'max' },
  pageEvidence: '执行代理/sol_rune_health_gate/42-致命一击原对象安全草稿返回.json',
  originalObject: page.object, pageBusinessWrites: 0, independentGETs: audit.length,
  formulaPreflight: page.formulaPreflight, unsavedResultCleanup: page.unsavedResultCleanup,
  savedResultTypeLockedAsExpected: page.savedResultType.selectorDisabled,
  unchangedIncludingTimestamps: true, noDraftOrDialogs: true,
  scope: '原对象动态门槛公式提交前校验、草稿保留及新结果切种类清理确认；不是整符文完成',
  audit, values
};
const ledgerPath = path.join(here, '..', '阶段进度.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')), before = structuredClone(ledger);
const batch = ledger.mechanismBatches.conditionalDamageModifierReturn;
assert.equal(batch.independentlyVerifiedWrites, 6);
assert.equal(batch.additionalDraftReturnPending, true);
batch.additionalDraftReturnPending = false;
batch.additionalDraftReturn = { evidence, status: 'PASSED', pageBusinessWrites: 0, independentGETs: 38,
  formulaPreflightPassed: true, cleanupConfirmationPassed: true, persistedDataUnchanged: true };
batch.pageState = '原对象与同类6笔保存及正式组成运行通过；原对象安全草稿返回0写、38次独立回读不变；普通伤害来源范围继续核定';
const check = structuredClone(ledger);
check.mechanismBatches.conditionalDamageModifierReturn = before.mechanismBatches.conditionalDamageModifierReturn;
assert.deepEqual(check, before);
fs.writeFileSync(path.join(here, '58-符文安全草稿返回独立验收.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ independentGETs: audit.length, allUnchanged: true, pageWrites: 0, coverageChanged: false }));
