import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), ledgerPath = path.join(here, '..', '阶段进度.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')), before = structuredClone(ledger);
const rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const evidence = rel + '47-条件伤害修复检查点.json';
assert(!ledger.mechanismBatches.conditionalDamageModifierReturn, '检查点已存在，先检查不重放');
const files = ['web/src/engine/damageModifierAdapter.ts', 'web/src/engine/damageModifierAdapter.test.ts'];
const proof = { at: new Date().toISOString(), status: 'IMPLEMENTING_NOT_PAGE_CLOSED',
  originalObject: 'rune_8014', peerObject: 'rune_8017',
  question: '逐笔敌方英雄生命比例条件能否与已有伤害过滤、乘区、引用和初始化入口完整表达',
  actualPageGap: rel + '执行代理/sol_rune_health_gate/06-致命一击真实表单能力核验.json',
  independentPreflight: rel + '符文生命门槛准备/09-返回前独立现值.json',
  protectedGETs: 32, newObjectsAbsent: 6, preflightGETs: 38, businessWrites: 0,
  backend: { fullTests: 1274, failures: 0, servicePID: 37204, restartReadback: rel + '46-条件伤害后端服务与保护数据复核.json' },
  host: { targetedTests: 21, typecheck: 'PASS', independentReview: 'READY_STATIC',
    files: files.map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join('C:/project/damage_web_dev', file))).digest('hex') })) },
  native: { status: '短路条件内部运算正在实施，先前暴击来源证据P2已修复，最终产物待重新验收',
    fullSuite: 'FAIL', missingSeedTests: 38, exclusiveWorktreeTests: 4,
    evidence: rel + '条件伤害原生实现/验收记录.md' },
  firstPageScope: '有真实用途的普通直接物理普攻条件增伤组成；已有过滤可完整表达，不用空类型掩盖特殊来源例外，不能记整符文完整',
  remaining: ['前端独立审查与真实页面原对象/同类返回', '逐笔保存关闭重开及独立回读', '最终原生短路运算与真实Wasm验证',
    '符文其余合格伤害范围及惩戒/打野宠物来源例外接线，反射待核'],
  pageClosed: false, runtimeValidated: false, wholeRuneComplete: false, coverageChanged: false };
// 文件名取实际存在的46号记录，不把历史摘要中的候选名字写成证据。
const restartFile = fs.readdirSync(here).filter(n => n.startsWith('46-') && n.endsWith('.json'));
assert.equal(restartFile.length, 1); proof.backend.restartReadback = rel + restartFile[0];
for (const link of [proof.actualPageGap, proof.independentPreflight, proof.backend.restartReadback, proof.native.evidence]) {
  assert(fs.existsSync(path.resolve(here, '../../..', link)), link);
}
ledger.mechanismBatches.conditionalDamageModifierReturn = { at: proof.at, status: proof.status, evidence,
  question: proof.question, originalObject: proof.originalObject, peerObject: proof.peerObject,
  pageBusinessWrites: 0, protectedGETs: 32, candidatePreflightGETs: 38,
  runtimeValidated: false, wholeRuneComplete: false, coverageChanged: false };
for (const key of ['rune_8014', 'rune_8017']) {
  const item = ledger.inventoryConclusions.runes.find(x => x.runeKey === key); assert(item);
  item.reason = '逐笔敌方英雄生命门槛已真实表单确认缺口，最小共性修复正在接入；普通直接物理普攻组成待页面返回，其他伤害来源与例外继续开放，整符文未完成。';
  item.evidenceRefs = [...new Set([...item.evidenceRefs, 'conditionalDamageModifierReturn'])];
  item.realPageRecovery = { status: 'PREPARED_NOT_SAVED', evidence, independentPreflight: proof.independentPreflight,
    pageBusinessWrites: 0, wholeRuneComplete: false, runtimeValidated: false };
}
assert.deepEqual(ledger.inventoryConclusions.coverage, before.inventoryConclusions.coverage);
const strip = value => { const out = structuredClone(value); delete out.mechanismBatches.conditionalDamageModifierReturn;
  for (const key of ['rune_8014', 'rune_8017']) { const index = out.inventoryConclusions.runes.findIndex(x => x.runeKey === key);
    out.inventoryConclusions.runes[index] = before.inventoryConclusions.runes[index]; } return out; };
assert.deepEqual(strip(ledger), before);
fs.writeFileSync(path.join(here, '47-条件伤害修复检查点.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
assert.deepEqual(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')), ledger);
console.log(JSON.stringify({ status: 'CHECKPOINT_RECORDED', rows: 2, coverageUnchanged: true, businessWrites: 0 }));
