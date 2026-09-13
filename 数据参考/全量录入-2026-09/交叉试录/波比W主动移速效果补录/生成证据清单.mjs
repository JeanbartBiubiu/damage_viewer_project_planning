import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEffect, expectedCurrent, target } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, '09-证据清单.json');
if (fs.existsSync(output)) throw new Error('09-证据清单.json 已存在，拒绝覆盖。');
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required = [
  ['README.md', '批次入口与恢复顺序'],
  ['01-补录方案.md', '主负责人语义方案'],
  ['批次配置.mjs', '唯一请求与页面目标配置'],
  ['批次执行.mjs', '纯GET预检与受保护单次写入'],
  ['02-冻结请求.json', '完整冻结请求及散列'],
  ['03-来源散列快照.json', '固定来源与上一规则检查点'],
  ['04-写入前现值.json', '目标完整写前基线'],
  ['05-只读准备报告.json', '纯GET预检结果'],
  ['06-写入与即时回读.json', '一次POST及即时回读'],
  ['独立GET回读.mjs', '新代理独立只读检查器'],
  ['07-独立GET回读.json', '全量规则与目标最终回读'],
  ['只读页面验收.mjs', '冻结目标生成的页面检查'],
  ['08-页面验收.json', '真实浏览器只读验收'],
  ['录入体验报告.md', '操作成本、歧义与恢复'],
  ['生成证据清单.mjs', '证据完整性生成器']
];
const freeze = read('02-冻结请求.json');
const source = read('03-来源散列快照.json');
const baseline = read('04-写入前现值.json');
const preparation = read('05-只读准备报告.json');
const write = read('06-写入与即时回读.json');
const independent = read('07-独立GET回读.json');
const browser = read('08-页面验收.json');
for (const name of browser.screenshots) required.push(['页面截图/' + name, '真实浏览器截图']);
for (const [name] of required) assert(fs.existsSync(path.join(here, name)), '缺少证据文件：' + name);
assert.deepEqual(freeze.request.body, buildEffect());
assert.equal(preparation.status, 'READY_FOR_MAIN_REVIEW');
assert.equal(preparation.businessWrites, 0);
assert.equal(preparation.candidateStatus, 404);
assert.equal(write.status, 'PASS');
assert.equal(write.postCount, 1);
assert.equal(write.replayedWrites, 0);
assert.equal(write.recoveryReadPerformed, false);
assert.equal(independent.status, 'PASS');
assert.equal(independent.businessWrites, 0);
assert.equal(independent.differenceCount, 0);
assert.equal(independent.globalReadback.skillCount, expectedCurrent.skillCount);
assert.equal(independent.globalReadback.ruleCount, expectedCurrent.ruleCount);
assert.equal(independent.globalReadback.sourceInitializedCount, expectedCurrent.sourceInitializedCount);
assert.equal(independent.targetReadback.newEffectEqualsFrozenBody, true);
assert.equal(independent.targetReadback.existingEffectUnchanged, true);
assert.equal(browser.status, 'PASS');
assert.equal(browser.businessWrites, 0);

const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  sourceVersion: '16.17/16.17.1',
  target: {
    skillKey: target.skillKey,
    effectKey: target.effectKey,
    resultKey: target.resultKey,
    conclusion: '已录入坚定风采主动自身40%移速、持续2000毫秒的效果定义；触发和反突进等分支仍暂缓。'
  },
  frozen: {
    batchSha256: freeze.batchSha256,
    bodySha256: freeze.request.bodySha256,
    sourceSnapshotSha256: freeze.sourceSnapshotSha256,
    baselineSha256: preparation.baselineSha256,
    allowedOperations: freeze.allowedOperations
  },
  preparation: {
    getCount: preparation.getCount,
    businessWrites: preparation.businessWrites,
    candidateStatus: preparation.candidateStatus,
    existingEffectKeys: preparation.existingEffectKeys,
    repeatedFullBaselineCount: preparation.repeatedFullBaselineCount
  },
  writer: {
    getCount: write.getCount,
    postCount: write.postCount,
    replayedWrites: write.replayedWrites,
    recoveryReadPerformed: write.recoveryReadPerformed,
    bodySha256: write.bodySha256
  },
  independentReadback: {
    getCount: independent.getCount,
    businessWrites: independent.businessWrites,
    skillCount: independent.globalReadback.skillCount,
    ruleCount: independent.globalReadback.ruleCount,
    sourceInitializedCount: independent.globalReadback.sourceInitializedCount,
    ruleCheckpointUnchanged: independent.globalReadback.matchesPriorIndependentCheckpoint,
    effectKeys: independent.targetReadback.effectKeys,
    newEffectSha256: independent.targetReadback.newEffectNormalizedSha256,
    protectedKindsUnchanged: independent.targetReadback.protectedKindsUnchanged
  },
  browser: {
    browser: browser.browser,
    methods: browser.methods,
    businessWrites: browser.businessWrites,
    screenshots: browser.screenshots,
    diagnostics: browser.diagnostics,
    passed: browser.passed
  },
  sourceObjectSha256: source.objectSha256,
  writeBeforeTargetSha256: preparation.targetSnapshotSha256,
  files: required.map(([relativePath, role]) => ({ relativePath, role, sha256: sha(path.join(here, relativePath)) })),
  boundaries: {
    managementSaved: true,
    apiReadback: true,
    browserValidated: true,
    wasmInputAssembled: false,
    hostEventProduced: false,
    runtimeValidated: false,
    combatValidated: false
  }
};
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, target: target.skillKey + '/' + target.effectKey, ruleCount: manifest.independentReadback.ruleCount, effectKeys: manifest.independentReadback.effectKeys, browserPassed: manifest.browser.passed, fileCount: manifest.files.length }, null, 2));
