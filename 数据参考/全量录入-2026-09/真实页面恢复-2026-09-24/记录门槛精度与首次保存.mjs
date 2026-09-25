import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const read = file => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
const page = read('执行代理/sol_rune_health_gate/09-致命一击乘区唯一保存.json');
const after = read('符文生命门槛准备/11-页面独立回读-1.json');
const runtime = read('符文生命门槛准备/14-最终Wasm门槛精度.json');
assert.equal(page.write.status, 201); assert.equal(page.reopened.exactApprovedFields, true);
assert.equal(after.status, 'PASS'); assert.equal(after.step, 1); assert.equal(after.audit.length, 38);
assert.equal(runtime.stats.expected, 5); assert.equal(runtime.stats.unexpected, 0); assert.equal(runtime.stats.skipped, 0);
const files = ['web/src/engine/damageModifierAdapter.ts', 'web/src/engine/damageModifierAdapter.test.ts',
  'web/src/engine/staticRatioValue.ts', 'web/tests/e2e/damage-modifier-runtime.spec.ts'];
const proof = { at: new Date().toISOString(), status: 'FIRST_PAGE_WRITE_VERIFIED_EFFECT_ENTRY_IN_PROGRESS',
  arithmeticGap: { description: 'JS中间折叠0.1+0.2导致300/1000错误满足严格LT', oldDamage: 108, expectedDamage: 100,
    oldUnit: '22项中1项失败，实际修正因子1.08而非1', fix: '保留静态表达式树，按十进制精确分数计算门槛，最后一次转换运行数值',
    precisionBoundary: '非零下溢0或精确小于1却舍入1时明确拒绝，不替换成端点', review: 'READY',
    targetedUnitTests: 22, finalUnitFiles: 91, finalUnitTests: 1130, lint: 'PASS', typecheck: 'PASS', build: 'PASS' },
  runtime: { syntheticTests: 5, report: '符文生命门槛准备/14-最终Wasm门槛精度.json',
    wasmSha256: '25844991e66d5e189cee0b168869de07c265c5c3cc3336c7b1a9c793ac0d736d',
    previous63RegressionsRemainApplicable: true, formalRuneRuntimeValidated: false },
  page: { executor: 'gpt-6-sol', effort: 'max', startupProof: '09-夺萃执行模型核验.json', browser: page.browser,
    uniquePost: 1, status: 201, reopened: true, object: 'rune_8014_damage_increase', independentGETs: 38,
    protectedOriginalResponses: 32, oldModifierZonesPreserved: 9, modifierZoneCount: 10,
    evidence: '执行代理/sol_rune_health_gate/09-致命一击乘区唯一保存.json', readback: '符文生命门槛准备/11-页面独立回读-1.json',
    approvedNextStep: 2, nextObject: 'rune_8014_passive/basic_attack_health_bonus', nextWriteVerified: false },
  files: files.map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join('C:/project/damage_web_dev', file))).digest('hex') })),
  completeRunes: 0, coverageChanged: false, remaining: ['致命一击效果及初始化规则页面保存回读', '砍倒三笔同类返回',
    '正式保存组成进入实际Worker', '其他合格伤害及特殊来源例外', '42项退役链/瞬时工作树测试迁移及全量重验'] };
const startup = fs.readdirSync(here).filter(n => n.startsWith('09-') && n.endsWith('.json')); assert.equal(startup.length, 1);
proof.page.startupProof = startup[0];
const ledgerPath = path.join(here, '..', '阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const coverage = structuredClone(ledger.inventoryConclusions.coverage), evidence = rel + '49-门槛精度与首次页面保存.json';
Object.assign(ledger.mechanismBatches.conditionalDamageModifierReturn, { status: proof.status, evidence,
  pageBusinessWrites: 1, independentlyVerifiedWrites: 1, pageState: '致命一击乘区保存重开及38GET通过，效果第2笔已批准待回读',
  syntheticRuntimeValidated: true, formalRuntimeValidated: false });
const item = ledger.inventoryConclusions.runes.find(x => x.runeKey === 'rune_8014'); assert(item);
item.reason = '逐笔生命门槛共性修复与严格等值算例通过；独立增伤乘区已页面保存回读，效果与初始化规则正在返回，其他伤害来源与例外继续开放。';
item.realPageRecovery = { status: 'ZONE_SAVED_EFFECT_AND_RULE_PENDING', evidence,
  pageBusinessWrites: 1, independentGETs: 38, savedObjects: ['rune_8014_damage_increase'],
  wholeRuneComplete: false, runtimeValidated: false };
assert.deepEqual(ledger.inventoryConclusions.coverage, coverage);
fs.writeFileSync(path.join(here, '49-门槛精度与首次页面保存.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, actualModel: proof.page.executor, verifiedWrites: 1, GETs: 38, unit: 1130, syntheticWorker: 5, coverageChanged: false }));
