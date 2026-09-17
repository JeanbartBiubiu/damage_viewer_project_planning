import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '10-证据清单.json');
if (fs.existsSync(outputPath)) throw new Error('10-证据清单.json 已存在，拒绝覆盖。');
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const frozen = read('02-冻结请求.json');
const source = read('03-来源散列快照.json');
const preflight = read('04-写入前现值.json');
const prepare = read('05-只读准备报告.json');
const write = read('06-写入与即时回读.json');
const independent = read('07-独立GET回读.json');
const pageTargets = read('08-页面目标.json');
const browser = read('09-页面验收.json');
assert.equal(frozen.status, 'FROZEN');
assert.equal(source.status, 'FROZEN');
assert.equal(preflight.status, 'PASS');
assert.equal(prepare.status, 'PASS');
assert.equal(write.status, 'PASS');
assert.equal(write.businessWrites, 4);
assert.equal(write.alreadyLanded, 0);
assert.equal(write.recoveryMode, false);
assert.deepEqual(write.requestAudit.methods, { GET: write.requestAudit.methods.GET, POST: 4 });
assert.equal(independent.status, 'PASS');
assert.equal(independent.businessWrites, 0);
assert.equal(independent.ruleCount, 135);
assert.equal(independent.sourceInitializedCount, 25);
assert.equal(independent.oldRulesCount, 131);
assert.equal(independent.targetChecks.length, 4);
assert.equal(pageTargets.status, 'PASS');
assert.equal(pageTargets.targetCount, 4);
assert.equal(browser.status, 'PASS');
assert.equal(browser.targetCount, 4);
assert.equal(browser.businessWrites, 0);
assert.equal(browser.nonGetRequests, 0);
assert.equal(browser.consoleErrors, 0);
assert.equal(browser.pageErrors, 0);
assert.equal(browser.failedRequests, 0);
assert.equal(browser.targets.every(item => item.matched), true);

const names = [
  '01-补录方案.md',
  'README.md',
  '批次配置.mjs',
  '批次执行.mjs',
  '独立GET回读.mjs',
  '生成页面目标.mjs',
  '生成证据清单.mjs',
  '02-冻结请求.json',
  '03-来源散列快照.json',
  '04-写入前现值.json',
  '05-只读准备报告.json',
  '06-写入流水.jsonl',
  '06-写入与即时回读.json',
  '07-独立GET回读.json',
  '08-页面目标.json',
  '09-页面验收.json',
  '录入体验报告.md'
];
for (const name of names) assert(fs.existsSync(path.join(here, name)), '缺少证据文件：' + name);
for (const item of source.scriptFiles) assert.equal(sha(path.join(here, item.name)), item.sha256, '冻结脚本漂移：' + item.name);
const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS',
  scope: '洛R、沃利贝尔R、阿克尚Q、嘉文E四项已有自身增益触发规则',
  frozenBatchSha256: frozen.batchSha256,
  sourceSnapshotSha256: sha(path.join(here, '03-来源散列快照.json')),
  prepare: { getCount: prepare.getCount, statusCounts: prepare.statusCounts, businessWrites: prepare.businessWrites },
  write: { businessWrites: write.businessWrites, alreadyLanded: write.alreadyLanded, recoveryMode: write.recoveryMode, requestAudit: write.requestAudit },
  independent: { getCount: independent.getCount, skillCount: independent.skillCount, ruleCount: independent.ruleCount, sourceInitializedCount: independent.sourceInitializedCount, oldRulesCount: independent.oldRulesCount, businessWrites: independent.businessWrites },
  browser: { targetCount: browser.targetCount, getRequests: browser.getRequests, nonGetRequests: browser.nonGetRequests, screenshots: browser.screenshots.length, consoleErrors: browser.consoleErrors, pageErrors: browser.pageErrors, failedRequests: browser.failedRequests, businessWrites: browser.businessWrites },
  files: names.map(name => ({ name, sha256: sha(path.join(here, name)), byteSize: fs.statSync(path.join(here, name)).size })),
  boundary: '四条管理规则、两路GET回读和真实页面通过；Wasm组装、宿主事件生产及真实战斗未执行。其余伤害、控制、生命、衰减和空间分支仍在开放队列。'
};
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, scope: manifest.scope, frozenBatchSha256: manifest.frozenBatchSha256, prepare: manifest.prepare, write: manifest.write, independent: manifest.independent, browser: manifest.browser, fileCount: manifest.files.length }, null, 2));
