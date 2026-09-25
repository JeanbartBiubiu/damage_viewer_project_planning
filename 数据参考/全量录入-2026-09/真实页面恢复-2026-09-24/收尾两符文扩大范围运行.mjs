import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), prep = path.join(here, '普通伤害来源准备');
const read = file => JSON.parse(fs.readFileSync(path.join(prep, file), 'utf8'));
const reportName = '17-正式保存来源范围工作线程.json', report = read(reportName);
assert.equal(report.stats.expected, 6); assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.skipped, 0);
const source = read('01-普通物理魔法真实伤害实际来源.json');
const saved = read('11-扩大过滤独立回读-4.json');
const host = read('宿主现值核验/适配结果.json');
const expected = { ...source.values, ...saved.values, '/vamp-rules': host.catalog.find(x => x.route === '/vamp-rules').data };
const flatten = suite => [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(flatten)];
let GETs = 0; const sourceCases = [], physicalCases = [], uniqueSources = new Set();
const close = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function checkSavedSnapshots(snapshots) {
  for (const [route, value] of Object.entries(snapshots)) {
    assert(Object.hasOwn(expected, route), route);
    assert.deepEqual(value, expected[route], `${route} 与最终独立回读一致`); GETs++;
  }
}
function checkRun(run) {
  assert.equal(run.compiled.ok, true); assert.equal(run.released.released, true);
  assert.equal(run.done.evidence.items.filter(x => x.kind === 'damage').length, 1);
  const { compileRequest: request, runRequest: runtime } = run.scenario;
  assert.equal(request.rulesHash, runtime.rulesHash); assert.equal(request.rulesHash, runtime.expectedRulesHash);
  assert.equal(request.rulesHash, runtime.initialSnapshot.rulesHash);
}
for (const spec of report.suites.flatMap(flatten)) {
  assert.equal(spec.tests.length, 1); assert.equal(spec.tests[0].results.length, 1);
  const test = spec.tests[0].results[0]; assert.equal(test.status, 'passed');
  const formal = test.attachments.find(x => x.name === 'source-reviewed-authoring-and-runs');
  if (formal) {
    const data = JSON.parse(Buffer.from(formal.body, 'base64').toString('utf8'));
    assert.equal(data.candidate, false); assert.equal(data.businessWrites, 0);
    assert.equal(data.runs.length, 4); checkSavedSnapshots(data.snapshots);
    const skill = data.source.skill.skillKey, rune = data.modifier.skillKey;
    assert(['annie_q', 'garen_r'].includes(skill)); assert(['rune_8014_passive', 'rune_8017_passive'].includes(rune));
    const key = `${skill}/${rune}`; assert(!uniqueSources.has(key)); uniqueSources.add(key);
    assert.deepEqual(data.modifier.effects[0], saved.values[`/skills/${rune}/effects/basic_attack_health_bonus`]);
    assert.deepEqual(data.modifier.rules[0], saved.values[`/skills/${rune}/trigger-rules/initialize_basic_attack_bonus`]);
    const coup = rune === 'rune_8014_passive';
    const cases = data.runs.map(run => {
      checkRun(run); assert(run.hiddenDamageRejection.includes('rules.operations'));
      const raw = skill === 'annie_q' ? 160 : 125 + (1000 - run.hp) / 4;
      const eligible = coup ? run.hp < 400 : run.hp > 600;
      const damage = raw * (eligible ? 1.08 : 1) / (skill === 'annie_q' ? 2 : 1);
      const actor = run.owner === 'source';
      close(run.done.summary[actor ? 'sourceDamageDealt' : 'targetDamageDealt'], damage);
      close(run.done.summary[actor ? 'targetFinalHp' : 'sourceFinalHp'], run.hp - damage);
      assert.equal(run.done.summary[actor ? 'sourceFinalHp' : 'targetFinalHp'], 900);
      assert.equal(run.scenario.sourceAudit.facts.length, 1);
      assert.equal(run.scenario.sourceAudit.facts[0].owner, run.owner);
      assert.equal(run.scenario.sourceAudit.facts[0].skillKey, skill);
      return { owner: run.owner, receiverHp: run.hp, raw, expectedDamage: damage, unknownDamageRejected: true };
    });
    assert.deepEqual(cases.filter(x => x.owner === 'source').map(x => x.receiverHp), coup ? [399, 400, 401] : [599, 600, 601]);
    assert.equal(cases.filter(x => x.owner === 'target').length, 1);
    sourceCases.push({ skillKey: skill, runeSkillKey: rune, cases });
  } else {
    const attachment = test.attachments.find(x => x.name === 'formal-authoring-and-runs'); assert(attachment);
    const data = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    assert.equal(data.businessWrites, 0); checkSavedSnapshots(data.snapshots);
    const rune = data.authored.skillKey, coup = rune === 'rune_8014_passive';
    assert(['rune_8014_passive', 'rune_8017_passive'].includes(rune));
    assert.deepEqual(data.authored.effects[0], saved.values[`/skills/${rune}/effects/basic_attack_health_bonus`]);
    const hps = coup ? [399, 400, 401] : [599, 600, 601], damages = coup ? [108, 100, 100] : [100, 100, 108];
    assert.equal(data.results.length, 3);
    for (const [index, run] of data.results.entries()) {
      checkRun(run); close(run.done.summary.sourceDamageDealt, damages[index]);
      close(run.done.summary.targetFinalHp, hps[index] - damages[index]); assert.equal(run.done.summary.sourceFinalHp, 900);
    }
    checkRun(data.restored); checkRun(data.reversed);
    const first = coup ? 100 : 108, next = coup ? 108 : 100;
    close(data.restored.done.summary.sourceDamageDealt, first); close(data.restored.resumed.summary.sourceDamageDealt, next);
    close(data.restored.resumed.summary.targetFinalHp, (coup ? 450 : 650) - first - next);
    assert.equal(data.restored.resumed.evidence.items.filter(x => x.kind === 'damage').length, 1);
    close(data.reversed.done.summary.targetDamageDealt, 108); assert.equal(data.reversed.done.summary.targetFinalHp, 900);
    physicalCases.push({ runeSkillKey: rune, scope: '已保存符文加明确普通物理普攻输入；不是共享普攻正式组成',
      hps, damages, restoredDamage: [first, next], reverseDamage: 108 });
  }
}
assert.equal(sourceCases.length, 4); assert.equal(physicalCases.length, 2); assert.equal(GETs, 92);
const sourceSha = crypto.createHash('sha256').update(fs.readFileSync('C:/project/damage_web_dev/web/src/engine/ordinaryDamageSourceAudit.ts')).digest('hex');
assert.equal(sourceSha, '3199c6b831425b30b8c9e08ac075c27dc239a5d641fb9593cc731724c359ebe6');
const proof = { at: new Date().toISOString(), status: 'ORIGINAL_AND_PEER_ORDINARY_SOURCE_COMPONENT_CLOSED',
  actualExecutor: { model: 'gpt-6-sol', effort: 'max' }, realPageUpdates: 4, successful200: 4,
  independentSavedWriteGETs: 152, protectedModifierZones: 11, sourceAuditSha256: sourceSha,
  runtimeReport: '普通伤害来源准备/' + reportName, passedWorkerTests: 6, runtimeGETs: GETs,
  finalSavedDataMatchesRuntimeInputs: true, sourceCases, physicalCases,
  formalSourceRuntimeScenes: 16, formalExpandedRuntimePassed: true,
  scope: '已保存两符文的逐笔门槛与过滤组成；安妮Q/盖伦R完整所选命中伤害来源及明确物理普攻输入；其余技能分支和来源不由本批证明',
  pending: ['父效果表与行为总览过滤/门槛摘要遗漏的修复及原对象同类0写返回',
    '共享普攻结果级暴击倍率与命中联动运行缺口', '其他未核定来源、特殊来源及整符文范围'],
  wholeRunesComplete: false, coverageChanged: false };
const ledgerPath = path.join(here, '../阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const before = structuredClone(ledger), phase = ledger.mechanismBatches.conditionalDamageModifierReturn.sourceQualification;
assert.equal(phase.independentlyVerifiedUpdates, 4);
const evidence = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/66-两符文扩大范围正式保存与运行验收.json';
Object.assign(phase, { status: proof.status, evidence, formalExpandedRuntimePassed: true, passedWorkerTests: 6,
  formalSourceRuntimeScenes: 16, runtimeGETs: 92, runtimeScope: proof.scope, presentationReturnPending: true });
for (const runeKey of ['rune_8014', 'rune_8017']) {
  const row = ledger.inventoryConclusions.runes.find(item => item.runeKey === runeKey); assert(row);
  Object.assign(row.realPageRecovery.sourceScopeReturn, { status: proof.status, evidence,
    formalExpandedRuntimePassed: true, runtimeScope: proof.scope, presentationReturnPending: true });
  row.reason = '已保存普通直接伤害生命门槛与初始化组成，并完成原对象/同类及安妮Q魔法、盖伦R真实伤害的正式组成工作线程验证；共享普攻完整暴击/命中联动、未核定来源及整符文范围继续开放。父表与总览摘要遗漏另做显示修复返回。';
}
const check = structuredClone(ledger); check.mechanismBatches = before.mechanismBatches; check.inventoryConclusions.runes = before.inventoryConclusions.runes;
assert.deepEqual(check, before);
assert.deepEqual(ledger.inventoryConclusions.runes.filter(row => !['rune_8014', 'rune_8017'].includes(row.runeKey)),
  before.inventoryConclusions.runes.filter(row => !['rune_8014', 'rune_8017'].includes(row.runeKey)));
fs.writeFileSync(path.join(here, '66-两符文扩大范围正式保存与运行验收.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ realPageUpdates: 4, independentGETs: 152, passedWorkerTests: 6, runtimeGETs: 92,
  formalSourceRuntimeScenes: 16, wholeRunesComplete: false }));
