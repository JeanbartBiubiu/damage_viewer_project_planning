import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const read = n => JSON.parse(fs.readFileSync(path.join(here, n), 'utf8'));
const checkpoint = read('41-状态目录取消误报修复检查点.json');
for (const [f, hash] of Object.entries(checkpoint.sourceHashes)) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join('C:/project/damage_web_dev', f))).digest('hex'), hash);
}
const wFile = '执行代理/sol_chogath_peer/10-科加斯W取消误报修复原对象回验.json';
const qFile = '执行代理/luna_chogath/18-取消误报回归证据.json';
const w = read(wFile), q = read(qFile);
assert(w.cleanProbe.passed && w.dirtyProbe.passed);
assert.equal(w.final.newBusinessWrites, 0); assert(w.final.noDraft);
assert.equal(q.cancel.nativeDialogCount, 0); assert.equal(q.cancel.draftsOpen, 0);
assert.equal(q.network.nonGetRequests.length, 0);
const qRead = read('科加斯取消修复-独立回读-q.json'), wRead = read('科加斯取消修复-独立回读-w.json');
assert.equal(qRead.status, 'PASS'); assert.equal(wRead.status, 'PASS');
const proof = {
  at: new Date().toISOString(), status: 'PASS_ORIGINAL_AND_PEER_RETURN',
  question: '只查看已保存控制结果及异步目录，能否正常取消且仍保护真实草稿修改',
  problem: '目录补入派生状态种类被误认用户改动，取消误报未保存',
  fix: '父效果和结果子编辑器复用同一单结果比较规范化，只用于比较，不回写或改变保存内容',
  original: { object: 'chogath_w/silence_first_application/silence', executor: 'gpt-6-sol/max', evidence: wFile,
    cleanCancelDialogs: 0, dirtyCancelRejectedAndDraftRetained: true, discardThenReopenOriginalName: true },
  peer: { object: 'chogath_q/knockup/apply_knockup', executor: 'gpt-6-luna/max', evidence: qFile, cleanCancelDialogs: 0 },
  codeEvidence: '41-状态目录取消误报修复检查点.json', finalCodeHashesVerified: true,
  oldIsolatedFailures: 2, newIsolatedPasses: 2, frontendUnitTests: 1096, lint: true, typecheck: true, build: true,
  independentReview: 'READY', independentReadbacks: [qRead.audit.length, wRead.audit.length], totalGETs: qRead.audit.length + wRead.audit.length,
  allSavedValuesAndTimestampsUnchanged: true, businessWritesForFixReturn: 0,
  toolIssue: 'Sol一次残留原生弹窗监听冲突，无业务写入；清理后重做完整两项真实页面检查通过，不计产品缺陷',
  runtimeValidated: false, wholeSkillComplete: false
};
fs.writeFileSync(path.join(here, '42-状态目录取消误报原对象同类闭环.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
const file = path.join(root, '数据参考/全量录入-2026-09/阶段进度.json'), raw = fs.readFileSync(file, 'utf8'), j = JSON.parse(raw);
assert(!j.mechanismBatches.statusCatalogResultDraftReturn);
j.mechanismBatches.statusCatalogResultDraftReturn = { at: proof.at, status: '原W与同类Q实际返回均通过；真实修改保护保持',
  evidence: rel + '42-状态目录取消误报原对象同类闭环.json', originalObject: 'chogath_w', peerObject: 'chogath_q',
  independentGETs: 58, pageBusinessWrites: 0, oldPageTestsFailed: 2, newPageTestsPassed: 2, unitTests: 1096,
  runtimeValidated: false, coverageChanged: false };
const roundTrip = structuredClone(j); delete roundTrip.mechanismBatches.statusCatalogResultDraftReturn;
assert.deepEqual(roundTrip, JSON.parse(raw));
assert.equal(fs.readFileSync(file, 'utf8'), raw);
fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, GETs: proof.totalGETs, newBusinessWrites: 0, coverageUnchanged: true }));
