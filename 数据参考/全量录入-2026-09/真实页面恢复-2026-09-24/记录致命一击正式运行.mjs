import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const read = p => JSON.parse(fs.readFileSync(path.join(here, p), 'utf8'));
const reportName = '符文生命门槛准备/16-致命一击正式保存组成工作线程.json';
const report = read(reportName), before = read('符文生命门槛准备/11-页面独立回读-3.json');
assert.equal(report.stats.expected, 1); assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.skipped, 0);
const attachment = report.suites.flatMap(s => s.specs ?? []).flatMap(s => s.tests).flatMap(t => t.results)
  .flatMap(r => r.attachments).find(a => a.name === 'formal-authoring-and-runs'); assert(attachment?.body);
const data = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
assert.equal(data.businessWrites, 0);
for (const [route, value] of Object.entries(data.snapshots)) assert.deepEqual(value, before.values[route], route);
assert.deepEqual(data.authored.effects, [before.values['/skills/rune_8014_passive/effects/basic_attack_health_bonus']]);
assert.deepEqual(data.authored.rules, [before.values['/skills/rune_8014_passive/trigger-rules/initialize_basic_attack_bonus']]);
const boundary = data.results.map((r, i) => {
  assert.equal(r.compiled.ok, true); assert.equal(r.released.released, true);
  const hp = 399 + i, expected = i === 0 ? 108 : 100;
  assert.equal(r.done.summary.sourceDamageDealt, expected); assert.equal(r.done.summary.targetFinalHp, hp - expected);
  return { hp, maxHp: 1000, baseDamage: 100, damage: expected, targetFinalHp: hp - expected };
});
assert.equal(data.restored.done.summary.sourceDamageDealt, 100);
assert.equal(data.restored.resumed.summary.sourceDamageDealt, 108);
assert.equal(data.restored.resumed.summary.targetFinalHp, 242);
assert.equal(data.reversed.done.summary.targetDamageDealt, 108);
assert.equal(data.reversed.done.summary.sourceFinalHp, 291);
const proof = { at: new Date().toISOString(), status: 'ORIGINAL_OBJECT_PAGE_AND_BOUNDED_RUNTIME_PASS',
  question: '致命一击真实结果表单缺少逐笔敌方英雄生命门槛，修复后能否保持严格边界与原引用',
  executor: { model: 'gpt-6-sol', effort: 'max' },
  pageWrites: 3, unique201Responses: 3, pageReopened: true, pageIndependentGETs: 114,
  protectedOriginalResponses: 32, oldModifierZonesPreserved: 9,
  lastPage: rel + '执行代理/sol_rune_health_gate/20-致命一击规则唯一保存与返回.json',
  runtimeReport: rel + reportName, actualRuntimeGETs: Object.keys(data.snapshots).length,
  actualRuntimeSnapshotMatchesIndependentReadback: true, boundary,
  restored: { startHp: 450, firstDamage: 100, nextDamage: 108, finalHp: 242 },
  reverseOwner: { damage: 108, sourceFinalHp: 291 },
  runtimeScope: '仅正式保存的普通直接物理普攻条件增伤组成；基础100伤害和双方属性为明确场景输入',
  unusedRuntimeParameterProtectedWithoutDefault: true,
  originalPageGapReturned: true, peerPageReturnPending: true,
  wholeRuneComplete: false, coverageChanged: false };
const ledgerPath = path.join(here, '..', '阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = structuredClone(ledger), batch = ledger.mechanismBatches.conditionalDamageModifierReturn;
assert.equal(batch.independentlyVerifiedWrites, 3);
const evidence = rel + '52-致命一击正式组成运行与原对象返回.json';
Object.assign(batch, { evidence, status: proof.status, formalRuntimeObjects: ['rune_8014'],
  formalRuntimeValidated: false, pageState: '致命一击3笔与正式组成Worker通过；砍倒第4笔已批准，待同类返回' });
const item = ledger.inventoryConclusions.runes.find(x => x.runeKey === 'rune_8014'); assert(item);
Object.assign(item.realPageRecovery, { status: proof.status, evidence, runtimeValidated: true, runtimeScope: proof.runtimeScope });
item.reason = '普通直接物理普攻的生命门槛组成已页面保存重开、114GET及正式数据Worker通过；其他伤害来源、例外和整符文继续开放。';
assert.deepEqual(ledger.inventoryConclusions.coverage, old.inventoryConclusions.coverage);
const check = structuredClone(ledger); check.mechanismBatches.conditionalDamageModifierReturn = old.mechanismBatches.conditionalDamageModifierReturn;
check.inventoryConclusions.runes = old.inventoryConclusions.runes; assert.deepEqual(check, old);
assert.deepEqual(ledger.inventoryConclusions.runes.filter(x => x.runeKey !== 'rune_8014'), old.inventoryConclusions.runes.filter(x => x.runeKey !== 'rune_8014'));
fs.writeFileSync(path.join(here, '52-致命一击正式组成运行与原对象返回.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, pageWrites: 3, pageGETs: 114, runtimeGETs: proof.actualRuntimeGETs,
  boundary, coverageChanged: false, wholeRuneComplete: false }));
