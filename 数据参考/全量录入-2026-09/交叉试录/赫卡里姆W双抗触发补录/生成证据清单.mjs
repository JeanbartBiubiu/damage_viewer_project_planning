import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRule, expectedCurrent, target } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, '09-证据清单.json');
if (fs.existsSync(output)) throw new Error('09-证据清单.json 已存在，拒绝覆盖。');

const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const sha = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const requiredFiles = [
  ['README.md', '批次入口与恢复顺序'],
  ['01-合并方案.md', '主负责人冻结语义'],
  ['批次配置.mjs', '唯一目标、请求和页面配置'],
  ['批次执行.mjs', '只读准备与受保护单次写入'],
  ['02-冻结请求.json', '完整冻结请求与批次散列'],
  ['03-来源散列快照.json', '固定来源及对象散列'],
  ['04-共享写前现值.json', '旧规则和目标写前基线'],
  ['05-只读准备报告.json', '纯GET预检结果'],
  ['06-写入与即时回读.json', '一次POST及即时回读'],
  ['独立GET回读.mjs', '新代理独立只读检查器'],
  ['07-独立GET回读.json', '最终131条规则独立回读'],
  ['只读页面验收.mjs', '由批次配置生成的页面目标'],
  ['08-页面验收.json', '真实浏览器只读验收'],
  ['录入体验报告.md', '操作成本、歧义与恢复'],
  ['生成证据清单.mjs', '证据完整性检查与清单生成器']
];

const freeze = read('02-冻结请求.json');
const source = read('03-来源散列快照.json');
const baseline = read('04-共享写前现值.json');
const preparation = read('05-只读准备报告.json');
const write = read('06-写入与即时回读.json');
const independent = read('07-独立GET回读.json');
const browser = read('08-页面验收.json');
for (const name of browser.screenshots) {
  requiredFiles.push(['页面截图/' + name, '真实浏览器页面截图']);
}
for (const [name] of requiredFiles) assert(fs.existsSync(path.join(here, name)), '缺少证据文件：' + name);

assert.equal(preparation.status, 'READY_FOR_MAIN_REVIEW');
assert.equal(preparation.businessWrites, 0);
assert.equal(write.status, 'PASS');
assert.equal(write.postCount, 1);
assert.equal(write.replayedWrites, 0);
assert.equal(independent.status, 'PASS');
assert.equal(independent.businessWrites, 0);
assert.equal(independent.differenceCount, 0);
assert.equal(independent.globalReadback.skillCount, expectedCurrent.skillCount);
assert.equal(independent.globalReadback.ruleCount, expectedCurrent.finalRuleCount);
assert.equal(independent.globalReadback.sourceInitializedCount, expectedCurrent.sourceInitializedCount);
assert.equal(independent.oldRuleComparison.comparedCount, expectedCurrent.ruleCount);
assert.equal(independent.oldRuleComparison.unchanged, true);
assert.equal(independent.newRule.id, target.skillKey + '/' + target.ruleKey);
assert.equal(independent.newRule.equalsFrozenBody, true);
assert.equal(browser.status, 'PASS');
assert.equal(browser.businessWrites, 0);
assert.deepEqual(browser.target.effectKeys, target.effectChecks.map(item => item.effectKey));
assert.deepEqual(freeze.request.body, buildRule());

const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  sourceVersion: '16.17/16.17.1',
  target: {
    skillKey: target.skillKey,
    ruleKey: target.ruleKey,
    effectKeys: target.effectChecks.map(item => item.effectKey),
    conclusion: '已录入主动使用后的自身护甲与魔法抗性分支；其余分支按体验报告暂缓。'
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
    skillCount: preparation.skillCount,
    priorRuleCount: preparation.ruleCount,
    sourceInitializedCount: preparation.sourceInitializedCount,
    candidateStatus: preparation.candidateStatus,
    repeatedFullBaselineCount: preparation.repeatedFullBaselineCount
  },
  writer: {
    getCount: write.getCount,
    postCount: write.postCount,
    replayedWrites: write.replayedWrites,
    recoveryReadPerformed: write.recoveryReadPerformed,
    status: write.status,
    bodySha256: write.bodySha256
  },
  independentReadback: {
    getCount: independent.getCount,
    businessWrites: independent.businessWrites,
    skillCount: independent.globalReadback.skillCount,
    finalRuleCount: independent.globalReadback.ruleCount,
    sourceInitializedCount: independent.globalReadback.sourceInitializedCount,
    priorRulesUnchanged: independent.oldRuleComparison.comparedCount,
    differenceCount: independent.differenceCount,
    newRuleBodySha256: independent.newRule.normalizedSha256,
    targetNonRuleSnapshotSha256: independent.targetReadback.nonRuleSnapshotSha256
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
  writeBeforeRuleRefsSha256: crypto.createHash('sha256').update(JSON.stringify(baseline.global.ruleRefs)).digest('hex'),
  files: requiredFiles.map(([relativePath, role]) => ({
    relativePath,
    role,
    sha256: sha(path.join(here, relativePath))
  })),
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
process.stdout.write(JSON.stringify({
  status: manifest.status,
  target: manifest.target.skillKey + '/' + manifest.target.ruleKey,
  finalRuleCount: manifest.independentReadback.finalRuleCount,
  priorRulesUnchanged: manifest.independentReadback.priorRulesUnchanged,
  browserPassed: manifest.browser.passed,
  fileCount: manifest.files.length
}, null, 2));
