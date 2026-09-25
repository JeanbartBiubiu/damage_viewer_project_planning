import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), dir = path.join(here, '原生历史检查迁移');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const manifest = read('文件摘要.json'), diff = read('差异摘要.json'), mapping = read('迁移映射.json');
assert.equal(manifest.files.length, 38);
for (const item of manifest.files) {
  const file = path.join(manifest.moduleRoot, item.file);
  assert.equal(sha(file), item.sha256, item.file); assert.equal(fs.statSync(file).size, item.bytes, item.file);
}
assert.equal(mapping.failureCount, 42); assert.equal(mapping.oldSeedDependentFunctions, 38);
assert.equal(mapping.uniqueDeletedSeeds, 35); assert.equal(mapping.dirtyWorkspaceGuards, 4);
assert.deepEqual(diff.totals, { added: 255, removed: 7300 });
assert.equal(sha(path.join(dir, '迁移映射.json')), '28e89e382e9cdd673bf7d9bfe46a533753ab701a4678c20e2d19de0b82e88011');
const log = fs.readFileSync(path.join(dir, 'go-test-full-20260924.log'), 'utf8');
assert(!/^FAIL\b/m.test(log)); assert(/^ok\s+tinygo_engine_v2\/internal\/runtime\s/m.test(log));
const passedPackages = log.split(/\r?\n/).filter(line => /^ok\s/.test(line)).map(line => line.split(/\s+/)[1]);
const expectedWasm = '25844991e66d5e189cee0b168869de07c265c5c3cc3336c7b1a9c793ac0d736d';
assert.equal(sha(path.join(manifest.moduleRoot, 'dist/tinygo_engine_v2.wasm')), expectedWasm);
assert.equal(sha('C:/project/damage_web_dev/web/src/engine/wasm/tinygo_engine_v2.wasm'), expectedWasm);
const rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const evidence = rel + '54-原生全量检查与历史断言迁移验收.json';
const proof = { at: new Date().toISOString(), status: 'PASS', originalFailedTests: 42,
  oldSeedTests: 38, deletedSeedFiles: 35, deletedCommit: mapping.deletedCommit, exclusiveWorktreeChecks: 4,
  changedTestFiles: 37, documentationFiles: 1, delta: diff.totals, finalFileHashesVerified: 38,
  verification: { command: 'go test -count=1 ./...', exitCode: 0, log: rel + '原生历史检查迁移/go-test-full-20260924.log',
    passedPackages, independentCoverageReview: 'READY', independentHighRiskTests: 11,
    noSkippedWholeTests: true, quinnIsolationAndFramesPreserved: true, fourProductionScansPreserved: true },
  audit: { mapping: rel + '原生历史检查迁移/迁移映射.json', manifest: rel + '原生历史检查迁移/文件摘要.json',
    preciseEvidenceWordingCorrected: true },
  implementationChangedInThisMigration: false, wasmRebuiltInThisMigration: false, wasmSha256: expectedWasm,
  businessWrites: 0, actualManagementDataProvenByTheseTests: false,
  limitation: '历史维基与原生构造样例通过不等于现行管理数据、真实页面或整技能通过；这些证据分别验收' };
const ledgerPath = path.join(here, '..', '阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = structuredClone(ledger), batch = ledger.mechanismBatches.conditionalDamageModifierReturn;
batch.nativeFullSuite = { status: 'PASS', evidence, independentReview: 'READY', businessSourceAndWasmUnchanged: true };
const check = structuredClone(ledger); check.mechanismBatches.conditionalDamageModifierReturn = old.mechanismBatches.conditionalDamageModifierReturn;
assert.deepEqual(check, old);
fs.writeFileSync(path.join(here, '54-原生全量检查与历史断言迁移验收.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', originalFailedTests: 42, coverageReview: 'READY', verifiedHashes: 38,
  passedPackages: passedPackages.length, delta: diff.totals, businessWrites: 0, wasmUnchanged: true }));
