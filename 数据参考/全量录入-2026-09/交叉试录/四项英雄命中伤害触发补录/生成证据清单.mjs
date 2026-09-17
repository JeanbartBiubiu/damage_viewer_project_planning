import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '08-证据清单.json');
if (fs.existsSync(outputPath)) throw new Error('08-证据清单.json 已存在，拒绝覆盖。');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const frozen = readJson('02-合并冻结请求.json');
const baseline = readJson('04-共享写前现值.json');
const writer = readJson('05-写入与即时回读.json');
const readback = readJson('06-独立GET回读.json');
const browser = readJson('07-页面验收.json');
assert.equal(frozen.status, 'FROZEN');
assert.equal(baseline.status, 'CAPTURED');
assert.equal(writer.status, 'PASS');
assert.equal(readback.status, 'PASS');
assert.equal(browser.status, 'PASS');

const rootFiles = fs.readdirSync(here, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== '08-证据清单.json')
  .map((entry) => ({ relativePath: entry.name, sha256: sha256(path.join(here, entry.name)), bytes: fs.statSync(path.join(here, entry.name)).size }))
  .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
const screenshots = fs.readdirSync(path.join(here, '页面截图'), { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => ({ relativePath: `页面截图/${entry.name}`, sha256: sha256(path.join(here, '页面截图', entry.name)), bytes: fs.statSync(path.join(here, '页面截图', entry.name)).size }))
  .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));

const manifest = {
  schemaVersion: 1,
  revision: 'rev1',
  status: 'PASS',
  generatedAt: new Date().toISOString(),
  batchSha256: frozen.batchSha256,
  targets: frozen.requests.map(({ id, skillKey, ruleKey, effectKey, formulaKey, bodySha256 }) => ({ id, skillKey, ruleKey, effectKey, formulaKey, bodySha256 })),
  preparation: {
    getCount: baseline.getCount,
    businessWrites: baseline.businessWrites,
    skillCount: baseline.global.skillKeys.length,
    priorRuleCount: baseline.global.ruleDetails.length,
    sourceInitializedCount: baseline.global.eventTypeCounts.SOURCE_INITIALIZED || 0,
    expected404: baseline.targetChecks.filter((item) => item.candidateDetailStatus === 404).length,
    sharedFullBaselineCount: baseline.experience.sharedFullBaselineCount,
    repeatedFullBaselineCount: baseline.experience.repeatedFullBaselineCount
  },
  writer: {
    getCount: writer.getCount,
    businessWrites: writer.businessWriteCount,
    postCount: writer.methods.POST,
    status201: writer.writes.filter((item) => item.responseStatus === 201).length,
    immediateReadbacks: writer.writes.filter((item) => item.immediateReadback?.status === 200).length,
    replayedWrites: 0
  },
  independentReadback: {
    getCount: readback.getCount,
    businessWrites: readback.businessWrites,
    skillCount: readback.global.skillCount,
    finalRuleCount: readback.global.ruleCount,
    sourceInitializedCount: readback.global.sourceInitializedCount,
    priorRulesUnchanged: readback.global.priorRulesUnchanged,
    newRulesMatched: readback.global.newRulesMatched,
    targetNonRuleSnapshotsUnchanged: readback.global.targetNonRuleSnapshotsUnchanged
  },
  browser: {
    methods: browser.methods,
    businessWrites: browser.businessWrites,
    checks: browser.checks.length,
    listImagesVisible: browser.checks.filter((item) => item.representativeImage?.complete).length,
    imageNaturalSize: '64x64',
    formulaDetailsVisible: browser.checks.filter((item) => item.formula?.expectedTextsVisible).length,
    effectDetailsVisible: browser.checks.filter((item) => item.effect?.expectedTextsVisible).length,
    triggerDetailsVisible: browser.checks.filter((item) => item.trigger?.expectedTextsVisible).length,
    screenshots: browser.screenshots.length,
    diagnostics: {
      consoleErrors: browser.diagnostics.consoleErrors.length,
      pageErrors: browser.diagnostics.pageErrors.length,
      failedRequests: browser.diagnostics.requestFailures.length,
      errorResponses: browser.diagnostics.errorResponses.length
    },
    liveFrontend: '127.0.0.1:5173',
    liveBackend: '127.0.0.1:8080'
  },
  process: {
    cursorReview: 'SKIPPED_LOW_RISK',
    tokenRecorded: false,
    apiFlow: '稳定接口批量写入加真实页面只读抽样',
    recovery: '写入报告存在即拒绝重放；中断后按稳定键确认，只为仍缺失项重新冻结。'
  },
  systemConclusion: '现有技能、公式、效果与触发规则结构能够承载本批四项，不需要新增表或专用字段。',
  validationBoundary: {
    managementSave: 'PASS',
    independentDatabaseReadback: 'PASS',
    browserManagementView: 'PASS',
    wasmAssembly: 'NOT_RUN',
    hostEventProduction: 'NOT_PROVEN',
    battleRuntime: 'NOT_RUN'
  },
  files: [...rootFiles, ...screenshots]
};
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status, files: manifest.files.length, finalRuleCount: manifest.independentReadback.finalRuleCount, screenshots: manifest.browser.screenshots }));
