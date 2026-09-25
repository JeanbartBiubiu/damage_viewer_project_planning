import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const read = file => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
const reportName = '符文生命门槛准备/18-两符文正式组成与不同生命工作线程.json';
const report = read(reportName), current = read('符文生命门槛准备/11-页面独立回读-6.json');
assert.equal(report.stats.expected, 2); assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.skipped, 0);
const attachments = report.suites.flatMap(s => s.specs ?? []).flatMap(s => s.tests).flatMap(t => t.results)
  .flatMap(r => r.attachments).filter(a => a.name === 'formal-authoring-and-runs'); assert.equal(attachments.length, 2);
const rows = [];
for (const attachment of attachments) {
  const data = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
  const id = data.authored.skillKey === 'rune_8014_passive' ? 8014 : 8017;
  assert(['rune_8014_passive', 'rune_8017_passive'].includes(data.authored.skillKey));
  assert.equal(data.businessWrites, 0);
  for (const [route, value] of Object.entries(data.snapshots)) assert.deepEqual(value, current.values[route], route);
  assert.deepEqual(data.authored.effects, [current.values[`/skills/rune_${id}_passive/effects/basic_attack_health_bonus`]]);
  assert.deepEqual(data.authored.rules, [current.values[`/skills/rune_${id}_passive/trigger-rules/initialize_basic_attack_bonus`]]);
  const hps = id === 8014 ? [399, 400, 401] : [599, 600, 601];
  const damage = id === 8014 ? [108, 100, 100] : [100, 100, 108];
  const boundaries = data.results.map((run, i) => {
    assert.equal(run.compiled.ok, true); assert.equal(run.released.released, true);
    assert.equal(run.done.summary.sourceFinalHp, 900);
    assert.equal(run.done.summary.sourceDamageDealt, damage[i]);
    assert.equal(run.done.summary.targetFinalHp, hps[i] - damage[i]);
    assert.equal(run.done.evidence.items.filter(x => x.kind === 'damage').length, 1, '不是另造补伤');
    return { ownerHp: 900, receiverHp: hps[i], maxHp: 1000, rawDamage: 100, damage: damage[i] };
  });
  const first = id === 8014 ? 100 : 108, next = id === 8014 ? 108 : 100, startHp = id === 8014 ? 450 : 650;
  assert.equal(data.restored.done.summary.sourceDamageDealt, first);
  assert.equal(data.restored.resumed.summary.sourceDamageDealt, next);
  assert.equal(data.restored.resumed.summary.targetFinalHp, startHp - first - next);
  assert.equal(data.reversed.done.summary.targetDamageDealt, 108);
  assert.equal(data.reversed.done.summary.targetFinalHp, 900);
  assert.equal(data.reversed.done.summary.sourceFinalHp, (id === 8014 ? 399 : 601) - 108);
  rows.push({ runeKey: `rune_${id}`, boundaries, runtimeGETs: Object.keys(data.snapshots).length,
    restored: { startHp, firstDamage: first, nextDamage: next, finalHp: startHp - first - next },
    reverseOwnerDamage: 108, reverseOwnerHpPreserved: 900, approvedFilters: 'physics/BASIC_ATTACK/DIRECT/ANY critical',
    formalRuntimeValidated: true, wholeRuneComplete: false });
}
assert.equal(new Set(rows.map(r => r.runeKey)).size, 2);
const proof = { at: new Date().toISOString(), status: 'ORIGINAL_AND_PEER_BOUNDED_COMPONENT_CLOSED',
  question: '实际表单能否表达本笔敌方英雄生命门槛，并在保存和运行中保持严格比较、引用和实际双方',
  original: 'rune_8014', peer: 'rune_8017', actualExecutor: { model: 'gpt-6-sol', effort: 'max' },
  uniquePagePosts: 6, successful201: 6, pageClosedAndReopened: true,
  independentPageGETs: 228, protectedOriginalResponses: 32, protectedOriginalModifierZones: 9,
  currentModifierZones: 11, normalUIObservedNewBlockingIssues: false,
  runtimeReport: rel + reportName, runtimeGETs: rows.reduce((n, r) => n + r.runtimeGETs, 0),
  runtimeDataMatchesIndependentReadback: true, rows,
  oneRealDamageInstancePerHit: true, noPostDamageSupplement: true,
  scope: '两符文的普通直接物理普攻条件增伤组成；基础伤害、身份及双方生命为明确场景输入',
  pending: ['原对象安全草稿回验的公式保存前拦截与新结果清理确认',
    '来源核定清单及完整产伤路径扫描，再扩大普通魔法/真实与技能伤害范围', '特殊来源、反射及整符文范围继续核定'],
  nativeFullSuite: rel + '54-原生全量检查与历史断言迁移验收.json',
  wholeRunesComplete: false, coverageChanged: false };
const ledgerPath = path.join(here, '..', '阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const before = structuredClone(ledger), batch = ledger.mechanismBatches.conditionalDamageModifierReturn;
assert.equal(batch.independentlyVerifiedWrites, 6);
const evidence = rel + '57-两符文门槛原对象同类与正式运行验收.json';
Object.assign(batch, { status: proof.status, evidence, originalObjectPageConnected: true, peerObjectPageConnected: true,
  formalRuntimeObjects: ['rune_8014', 'rune_8017'], formalRuntimeValidated: true,
  runtimeScope: proof.scope, additionalDraftReturnPending: true,
  pageState: '原对象与同类共6笔页面保存、228GET及两份正式组成工作线程通过；扩展范围继续推进' });
for (const row of rows) {
  const item = ledger.inventoryConclusions.runes.find(x => x.runeKey === row.runeKey); assert(item);
  Object.assign(item.realPageRecovery, { status: proof.status, evidence, runtimeValidated: true, runtimeScope: proof.scope });
  item.reason = '普通直接物理普攻生命门槛组成已完成原对象/同类真实页面返回和正式数据Worker，严格边界、恢复重读与不同生命下反向拥有者通过；其他伤害来源与整符文继续开放。';
}
assert.deepEqual(ledger.inventoryConclusions.coverage, before.inventoryConclusions.coverage);
const check = structuredClone(ledger); check.mechanismBatches.conditionalDamageModifierReturn = before.mechanismBatches.conditionalDamageModifierReturn;
check.inventoryConclusions.runes = before.inventoryConclusions.runes; assert.deepEqual(check, before);
assert.deepEqual(ledger.inventoryConclusions.runes.filter(x => !rows.some(r => r.runeKey === x.runeKey)),
  before.inventoryConclusions.runes.filter(x => !rows.some(r => r.runeKey === x.runeKey)));
fs.writeFileSync(path.join(here, '57-两符文门槛原对象同类与正式运行验收.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, pageWrites: 6, pageGETs: 228, formalRuntimeObjects: rows.map(r => r.runeKey),
  runtimeGETs: proof.runtimeGETs, coverageChanged: false, wholeRunesComplete: false }));
