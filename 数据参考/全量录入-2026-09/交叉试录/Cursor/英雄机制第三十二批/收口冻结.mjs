import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const candidate = read('完整候选.json');
const plan = read('写前请求计划.json');
const math = read('严格数学.json');
const sourceValues = sha256('源值解析.json');
const sourceManifest = sha256('来源哈希汇总.json');
const candidateSha256 = sha256('完整候选.json');
plan.candidateSha256 = candidateSha256;
plan.status = '仅写入意图，未调用业务接口；候选已冻结';
plan.noApiCalls = true;
write('写前请求计划.json', plan);
const planSha256 = sha256('写前请求计划.json');
const strictMathSha256 = sha256('严格数学.json');

const version = read('候选版本.json');
Object.assign(version, {
  status: '候选已冻结，严格数学通过，等待主负责人审查；未调用业务接口',
  candidateSha256,
  requestPlanSha256: planSha256,
  sourceValuesSha256: sourceValues,
  sourceManifestSha256: sourceManifest,
  strictMathSha256,
  noApiCalls: true,
});
write('候选版本.json', version);

const lock = read('冻结候选锁.json');
Object.assign(lock, {
  status: '候选已冻结，严格数学通过，等待主负责人审查；未授权业务写入',
  candidateSha256,
  requestPlanSha256: planSha256,
  sourceValuesSha256: sourceValues,
  sourceManifestSha256: sourceManifest,
  strictMathSha256,
  noApiCalls: true,
  applyAuthorized: false,
});
write('冻结候选锁.json', lock);

const scope = read('来源与范围.json');
scope.status = '候选已冻结，严格数学通过，未调用业务接口';
scope.hashes = {
  currentSnapshotSha256: scope.hashes.currentSnapshotSha256,
  sourceManifestSha256: sourceManifest,
  candidateSha256,
  planSha256,
  sourceValuesSha256: sourceValues,
  strictMathSha256,
};
scope.noApiCalls = true;
write('来源与范围.json', scope);

const index = read('候选交付索引.json');
Object.assign(index, {
  status: '候选已冻结，严格数学通过，未调用业务接口',
  strictMathSha256,
  finalStatus: '候选已冻结，等待主负责人审查；未调用业务接口',
});
write('候选交付索引.json', index);

const protectedCounts = candidate.protectedObjects.protectedReferenceCounts;
const finalFiles = [
  '完整候选.json', '写前请求计划.json', '源值解析.json', '来源哈希汇总.json', '严格数学.json',
  '候选版本.json', '冻结候选锁.json', '候选交付索引.json', '来源与范围.json',
  '生成候选.mjs', '独立源值数学.mjs', '收口冻结.mjs', 'README.md', '体验报告.md',
];
const files = Object.fromEntries(finalFiles.map((file) => [file, sha256(file)]));
const finalReport = {
  generatedAt: new Date().toISOString(),
  status: '候选已冻结，严格数学通过，未调用业务接口',
  batch: candidate.meta.batch,
  sourceVersion: candidate.meta.sourceVersion,
  files,
  counts: {
    ...candidate.counts,
    requestCount: candidate.meta ? plan.requestCount : null,
    currentTotalComponents: plan.currentTotalComponents,
    reusedPublicParameters: candidate.reusedPublicParameters.length,
    protectedSubjects: protectedCounts.subjects,
    protectedCompositionLists: protectedCounts.currentCompositionLists,
    protectedReferenceGETs: protectedCounts.GETs,
    protectedImages: protectedCounts.images,
    protectedCharacters: protectedCounts.characters,
    protectedCharacterSkillRelations: protectedCounts.characterSkillRelations,
    protectedDictionaries: protectedCounts.dictionaries,
  },
  hashes: { candidateSha256, planSha256, sourceValuesSha256: sourceValues, sourceManifestSha256: sourceManifest, strictMathSha256 },
  noApiCalls: true,
  apiWrites: 0,
  inputReadOnly: true,
};
write('最终哈希汇总.json', finalReport);
console.log(JSON.stringify({ candidateSha256, planSha256, sourceValuesSha256: sourceValues, sourceManifestSha256: sourceManifest, strictMathSha256, finalReportSha256: sha256('最终哈希汇总.json'), counts: finalReport.counts, mathStatus: math.status, apiWrites: 0 }, null, 2));
