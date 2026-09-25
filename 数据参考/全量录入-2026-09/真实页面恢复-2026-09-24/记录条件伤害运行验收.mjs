import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), planning = path.resolve(here, '../../..');
const web = 'C:/project/damage_web_dev';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const baseline = JSON.parse(fs.readFileSync(path.join(here, '00-恢复核对.json'), 'utf8'));
const protectedDirty = baseline.initialDirty.filter(x => !x.path.startsWith('文档记录/'));
for (const item of protectedDirty) assert.equal(sha(path.join(planning, item.path)), item.sha256, item.path);
const browser = JSON.parse(fs.readFileSync(path.join(here, '符文生命门槛准备/12-最终Wasm合成工作线程.json'), 'utf8'));
assert.equal(browser.stats.expected, 4); assert.equal(browser.stats.unexpected, 0); assert.equal(browser.stats.skipped, 0);
const wasm = path.join(web, 'web/src/engine/wasm/tinygo_engine_v2.wasm');
assert.equal(sha(wasm), '25844991e66d5e189cee0b168869de07c265c5c3cc3336c7b1a9c793ac0d736d');
const front = JSON.parse(fs.readFileSync(path.join(here, '条件伤害前端实现/前端实现-核验.json'), 'utf8'));
const files = [...front.changedFiles, 'web/src/engine/damageModifierAdapter.ts', 'web/src/engine/damageModifierAdapter.test.ts',
  'web/playwright.damage-modifier.config.ts', 'web/tests/e2e/damage-modifier-runtime.spec.ts',
  ...[4,5,6,7].map(n => `web/tests/e2e/p${n}-runtime.spec.ts`), 'web/src/engine/wasm/tinygo_engine_v2.wasm'];
const proof = { at: new Date().toISOString(), status: 'CODE_AND_SYNTHETIC_RUNTIME_PASS_PAGE_RETURN_IN_PROGRESS',
  original: 'rune_8014', peer: 'rune_8017',
  fixes: ['管理伤害修正加入逐笔生命资格与静态门槛引用', '门槛公式保存前读取表达式并逐等级核对，拒绝时保草稿',
    '切种类清除门槛纳入一次确认，取消完整保留', '原生伤害与暴击修正读实际命令双方，保持供值器真实拥有者',
    '复制伤害逐笔重算伤害修正，沿用冻结暴击与入场抗性，证据不混原笔暴击修正',
    '通用内部三参条件短路，未命中金额与自伤排除不读取无关值', '宿主身份与编译请求生成确定摘要，严格区分实际参与者属性'],
  review: { frontend: 'READY', host: 'READY', native: 'READY', pageCandidateAndReadback: 'READY' },
  frontend: { checks: front.checks, evidence: '条件伤害前端实现/前端实现-核验.json',
    finalBuildAfterWasmCopy: 'PASS, 1318 modules, exec session 97400 exit 0' },
  wasm: { bytes: fs.statSync(wasm).size, sha256: sha(wasm), actualCompileRunRelease: true,
    syntheticBrowserTests: 4, detailedReport: '符文生命门槛准备/12-最终Wasm合成工作线程.json',
    regression: { p4: { isolated: 11, liveGet: 2 }, p5: { isolated: 9, liveGet: 1 }, p6: { isolated: 20, liveGet: 4 },
      p7: { isolated: 6, liveGet: 2 }, vamp: { isolated: 4, liveGet: 4 }, total: 63, failures: 0 },
    liveTestsBusinessWrites: 0, nativeEvidence: '条件伤害原生实现/验收记录.md',
    fullNativeSuite: 'FAIL: 38 missing historical seed tests and 4 exclusive-worktree checks; follow-up investigation active' },
  page: { approvedStep: 1, independentlyVerifiedWrites: 0, state: 'Sol/max已获第一笔真实乘区创建批准，尚未回读，不推测保存状态',
    approval: '符文生命门槛准备/13-致命一击乘区页面批准.json' },
  limitations: ['正式符文配置尚未进入本次Worker，现有4项为明确合成场景', '完整符文与其他合格伤害来源及特殊来源例外仍待接线',
    '延迟复制跨运行快照恢复尚未实现，当前有明确警告', '未编译的暴击过滤、跨初始化组成同区及未知既有防御前乘区明确拒绝'],
  files: files.map(file => ({ file, sha256: sha(path.join(web, file)) })),
  unrelatedDirtyFilesPreserved: protectedDirty.length, coverageChanged: false, wholeRuneComplete: false };
const ledgerPath = path.join(here, '..', '阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const coverage = structuredClone(ledger.inventoryConclusions.coverage);
const rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/48-条件伤害运行与回归检查点.json';
Object.assign(ledger.mechanismBatches.conditionalDamageModifierReturn, { status: proof.status, evidence: rel,
  nativeCodeReviewed: true, syntheticRuntimeValidated: true, formalRuntimeValidated: false,
  pageState: proof.page.state, independentlyVerifiedWrites: 0 });
for (const key of ['rune_8014', 'rune_8017']) {
  const item = ledger.inventoryConclusions.runes.find(x => x.runeKey === key); assert(item);
  item.realPageRecovery.evidence = rel;
  item.reason = '逐笔生命门槛共性修复、前后端检查与合成Wasm边界已通过；普通直接物理普攻组成正在逐笔真实页面返回，其他伤害来源和例外继续开放，整符文未完成。';
}
assert.deepEqual(coverage, ledger.inventoryConclusions.coverage);
fs.writeFileSync(path.join(here, '48-条件伤害运行与回归检查点.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, syntheticTests: 4, regression: 63, protectedDirty: protectedDirty.length, coverageChanged: false }));
