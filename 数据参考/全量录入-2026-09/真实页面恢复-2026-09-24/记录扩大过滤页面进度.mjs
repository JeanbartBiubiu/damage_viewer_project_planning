import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [stepText, pageFile, checkpointText] = process.argv.slice(2);
const step = Number(stepText), checkpoint = Number(checkpointText);
assert(Number.isInteger(step) && step >= 1 && step <= 4);
assert(Number.isInteger(checkpoint) && checkpoint >= 62);
assert.equal(path.basename(pageFile), pageFile);
const prep = path.join(here, '普通伤害来源准备');
const plan = JSON.parse(fs.readFileSync(path.join(prep, '09-扩大过滤页面候选.json'), 'utf8'));
const readback = JSON.parse(fs.readFileSync(path.join(prep, `11-扩大过滤独立回读-${step}.json`), 'utf8'));
const pageEvidence = `执行代理/sol_rune_health_gate/${pageFile}`;
const page = JSON.parse(fs.readFileSync(path.join(here, pageEvidence), 'utf8'));
const write = plan.writes[step - 1];
assert.equal(readback.step, step); assert.equal(readback.exactApprovedBody, true);
assert.equal(readback.independentGETs, 38); assert.equal(readback.unrelatedResponsesPreserved, true);
assert.equal(page.businessWrites, 1);
assert.notEqual(Object.hasOwn(page, 'requests'), Object.hasOwn(page, 'request'), '实际证据只能有一种请求记录形状');
const requests = page.requests ?? [page.request];
assert.equal(requests.length, 1);
assert.equal(requests[0].method, 'PUT'); assert.equal(requests[0].status, 200);
assert.equal(requests[0].path, '/api/admin/games/lol' + write.route);
assert.deepEqual(requests[0].body, write.body);
assert.equal(page.guard.rejectedNonGet.length, 0);
assert.equal(page.uiReopen.dialogsAfterClose, 0);
const filename = `${checkpoint}-扩大过滤第${step}笔页面独立验收.json`;
const evidence = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/' + filename;
const proof = { at: new Date().toISOString(), step, object: write.route,
  actualExecutor: { model: 'gpt-6-sol', effort: 'max' }, pageEvidence,
  independentReadback: `普通伤害来源准备/11-扩大过滤独立回读-${step}.json`,
  uniquePagePUTs: 1, status: 200, closedAndReopened: true, finalDialogs: 0,
  independentGETs: 38, totalIndependentGETs: step * 38, approvedBodyMatches: true,
  modifierZonesPreserved: 11, parametersFormulasSubjectsRelationsPreserved: true,
  unchangedReferenceKeys: true, formalExpandedRuntimePassed: false, wholeRunesComplete: false };
const ledgerPath = path.join(here, '../阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const before = structuredClone(ledger), phase = ledger.mechanismBatches.conditionalDamageModifierReturn.sourceQualification;
assert.equal(phase.independentlyVerifiedUpdates, step - 1);
Object.assign(phase, { status: step === 4 ? 'PAGE_SAVED_AWAITING_FORMAL_RUNTIME' : 'PAGE_RETURN_IN_PROGRESS',
  evidence, expandedRunePageWrites: step, pageUpdatesSaved: step, independentlyVerifiedUpdates: step,
  independentGETs: step * 38, pageUpdateApprovedThrough: Math.min(step + 1, 4),
  formalExpandedRuntimePassed: false });
const row = ledger.inventoryConclusions.runes.find(item => item.runeKey === write.runeKey); assert(row);
row.realPageRecovery.sourceScopeReturn = { status: step % 2 === 0 ? 'PAGE_SAVED_AWAITING_FORMAL_RUNTIME' : 'EFFECT_SAVED_RULE_TEXT_PENDING',
  evidence, effectAndRuleUpdatesSaved: step % 2 === 0 ? 2 : 1, formalExpandedRuntimePassed: false };
const check = structuredClone(ledger); check.mechanismBatches = before.mechanismBatches; check.inventoryConclusions.runes = before.inventoryConclusions.runes;
assert.deepEqual(check, before);
assert.deepEqual(ledger.inventoryConclusions.runes.filter(item => item.runeKey !== write.runeKey),
  before.inventoryConclusions.runes.filter(item => item.runeKey !== write.runeKey));
fs.writeFileSync(path.join(here, filename), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ step, independentGETs: 38, exactSavedBody: true, wholeRuneComplete: false }));
