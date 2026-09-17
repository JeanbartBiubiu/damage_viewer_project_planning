import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.resolve(here, '..', '..', '..', '..', '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第二十五批', '修订一');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const strictFile = path.join(here, '严格数学.json');
if (!fs.existsSync(strictFile)) throw new Error('缺少严格数学.json，请先执行严格数学修订一.mjs');
const strict = readJson(strictFile);
const strictMathSha256 = sha256File(strictFile);
const versionFile = path.join(here, '候选版本.json');
const lockFile = path.join(here, '冻结候选锁.json');
const version = readJson(versionFile);
const lock = readJson(lockFile);
version.strictMathSha256 = strictMathSha256;
version.strictMathCounts = strict.counts;
version.status = '修订一候选、计划和严格数学已收口，等待主负责人审查；未调用业务接口';
lock.strictMathSha256 = strictMathSha256;
lock.strictMathCounts = strict.counts;
lock.status = '修订一候选、计划和严格数学已锁定，等待主负责人审查；未调用业务接口';
writeJson(versionFile, version);
writeJson(lockFile, lock);

const files = [
  '完整候选.json',
  '写前请求计划.json',
  '独立源值与算例.json',
  '来源哈希汇总.json',
  '严格数学.json',
  '候选版本.json',
  '冻结候选锁.json',
  '修订差异.json',
  'README.md',
  '体验报告.md',
  '生成修订候选.mjs',
  '严格数学修订一.mjs',
  '受保护写入器.mjs',
  '独立回读-实际GET.mjs',
  '收口修订一.mjs',
];
fs.mkdirSync(targetDir, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(here, file), path.join(targetDir, file));

const hashes = {};
for (const file of files) {
  const absolute = path.join(here, file);
  hashes[file] = { sha256: sha256File(absolute), bytes: fs.statSync(absolute).size };
}
const summary = {
  generatedAt: new Date().toISOString(),
  status: '第二十五批修订一候选已收口，未调用业务接口',
  batch: '英雄机制第二十五批',
  revision: 'hero25-source-v1-candidate-revision-1',
  sourceVersion: { clientVersion: '16.17', officialVersion: '16.17.1', build: '16.17.8104348+branch.releases-16-17.content.release' },
  counts: version.counts,
  candidateNewParameterCount: version.candidateNewParameterCount,
  currentParameterCountAfterSevenPublicReuse: version.currentParameterCountAfterSevenPublicReuse,
  requestCount: version.requestCount,
  businessWrites: 0,
  apiCalls: 0,
  strictMath: { ...strict.counts, passed: strict.passed },
  hashes,
  artifactDirectory: here,
  batchDirectory: targetDir,
  originalPreserved: {
    candidateSha256: version.originalCandidateSha256,
    requestPlanSha256: version.originalPlanSha256,
    sourceValuesSha256: version.originalSourceValuesSha256,
    sourceManifestSha256: version.originalManifestSha256,
    originalDirectoriesUntouched: true,
  },
  protectedCoverage: { subjects: 10, compositionLists: 60, reusedPublicParameters: 7 },
  noApiCalls: true,
};
writeJson(path.join(here, '最终哈希汇总.json'), summary);
fs.copyFileSync(path.join(here, '最终哈希汇总.json'), path.join(targetDir, '最终哈希汇总.json'));

const index = {
  generatedAt: summary.generatedAt,
  status: summary.status,
  batch: summary.batch,
  revision: summary.revision,
  heroes: ['蒙多医生', '泰达米尔'],
  paths: Object.fromEntries(files.concat('最终哈希汇总.json').map(file => [file, {
    artifact: path.join(here, file),
    batch: path.join(targetDir, file),
    sha256: (file === '最终哈希汇总.json' ? sha256File(path.join(here, file)) : hashes[file].sha256),
    bytes: fs.statSync(path.join(here, file)).size,
  }])),
  counts: summary.counts,
  candidateNewParameterCount: summary.candidateNewParameterCount,
  currentParameterCountAfterSevenPublicReuse: summary.currentParameterCountAfterSevenPublicReuse,
  requestCount: summary.requestCount,
  strictMath: summary.strictMath,
  protectedCoverage: summary.protectedCoverage,
  originalPreserved: summary.originalPreserved,
  noApiCalls: true,
};
writeJson(path.join(here, '候选交付索引.json'), index);
fs.copyFileSync(path.join(here, '候选交付索引.json'), path.join(targetDir, '候选交付索引.json'));

console.log(JSON.stringify({
  strictMathSha256,
  counts: summary.counts,
  candidateNewParameterCount: summary.candidateNewParameterCount,
  currentParameterCountAfterSevenPublicReuse: summary.currentParameterCountAfterSevenPublicReuse,
  requestCount: summary.requestCount,
  strictMath: summary.strictMath,
  artifactDirectory: here,
  batchDirectory: targetDir,
  noApiCalls: true,
}, null, 2));
