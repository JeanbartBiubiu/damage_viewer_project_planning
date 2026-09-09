import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const batchDir = path.resolve(here, '..', '..', '..', '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第二十五批');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(here, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(name) {
  return createHash('sha256').update(fs.readFileSync(path.join(here, name))).digest('hex');
}

const candidateSha256 = sha256('完整候选.json');
const requestPlanSha256 = sha256('写前请求计划.json');
const sourceValuesSha256 = sha256('独立源值与算例.json');
const sourceManifestSha256 = sha256('来源哈希汇总.json');
const strictMathSha256 = sha256('严格数学.json');
const candidate = readJson('完整候选.json');
const plan = readJson('写前请求计划.json');
const math = readJson('严格数学.json');
if (candidate.meta.businessWrites !== 0 || candidate.meta.apiCalls !== 0 || candidate.apiWrites !== 0) throw new Error('候选已经包含业务写入标记');
if (plan.businessWrites !== 0 || plan.noApiCalls !== true) throw new Error('计划不满足零业务写入');
if (math.passed !== true || math.noApiCalls !== true) throw new Error('严格数学尚未通过或包含接口调用');

const version = readJson('候选版本.json');
version.candidateSha256 = candidateSha256;
version.requestPlanSha256 = requestPlanSha256;
version.sourceValuesSha256 = sourceValuesSha256;
version.sourceManifestSha256 = sourceManifestSha256;
version.strictMathSha256 = strictMathSha256;
version.counts = candidate.counts;
version.requestCount = plan.requestCount;
version.businessWrites = 0;
version.status = '候选、严格数学和来源已收口，等待主负责人审查；未调用业务接口';
writeJson('候选版本.json', version);

const lock = readJson('冻结候选锁.json');
lock.candidateSha256 = candidateSha256;
lock.requestPlanSha256 = requestPlanSha256;
lock.sourceValuesSha256 = sourceValuesSha256;
lock.sourceManifestSha256 = sourceManifestSha256;
lock.strictMathSha256 = strictMathSha256;
lock.counts = candidate.counts;
lock.requestCount = plan.requestCount;
lock.businessWrites = 0;
lock.apiCalls = 0;
lock.status = '候选来源与严格数学已锁定，等待主负责人审查；未调用业务接口';
writeJson('冻结候选锁.json', lock);

const copyNames = ['完整候选.json', '写前请求计划.json', '独立源值与算例.json', '来源哈希汇总.json', '严格数学.json', '候选版本.json', '冻结候选锁.json'];
fs.mkdirSync(batchDir, { recursive: true });
for (const name of copyNames) fs.copyFileSync(path.join(here, name), path.join(batchDir, name));

const finalHashes = Object.fromEntries(copyNames.map(name => [name, { sha256: sha256(name), bytes: fs.statSync(path.join(here, name)).size }]));
finalHashes['候选版本.json'].sha256 = sha256('候选版本.json');
const summary = {
  generatedAt: new Date().toISOString(),
  status: '候选交付已收口，未调用业务接口',
  batch: '英雄机制第二十五批',
  sourceVersion: candidate.meta.sourceVersion,
  counts: candidate.counts,
  requestCount: plan.requestCount,
  businessWrites: 0,
  apiCalls: 0,
  strictMath: { passed: math.passed, formulas: math.counts.formulas, formulaCases: math.counts.formulaCases, rejectionCases: math.counts.rejectionCases, boundaryCases: math.counts.boundaryCases },
  hashes: finalHashes,
  artifactDirectory: here,
  batchDirectory: batchDir,
};
writeJson('最终哈希汇总.json', summary);
fs.copyFileSync(path.join(here, '最终哈希汇总.json'), path.join(batchDir, '最终哈希汇总.json'));
console.log(JSON.stringify({ candidateSha256, requestPlanSha256, sourceValuesSha256, sourceManifestSha256, strictMathSha256, counts: candidate.counts, requestCount: plan.requestCount, summary: path.join(here, '最终哈希汇总.json') }, null, 2));
