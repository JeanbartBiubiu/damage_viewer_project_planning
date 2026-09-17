import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const read = name => fs.readFileSync(new URL(name, here));
const json = name => JSON.parse(read(name));
const sha = name => createHash('sha256').update(read(name)).digest('hex');

if (fs.existsSync(new URL('冻结候选锁.json', here))) throw Error('冻结锁已存在，不覆盖。');

const candidate = json('完整候选.json');
const version = json('候选版本.json');
const writePlan = json('写前计划.json');
const math = json('独立源值与算例.json');
const readOnly = json('只读保护与公共参数.json');
const status = json('当前候选状态.json');

if (candidate.meta?.apiWrites !== 0) throw Error('候选带有业务写入标记。');
if (writePlan.policy?.businessWrites !== 0 || writePlan.policy?.apiCalls !== 0) throw Error('写前计划带有业务写入或接口调用标记。');
if (math.summary?.independentChecks?.failed !== 0) throw Error('独立算例存在失败项。');
if (readOnly.summary?.failures !== 0 || readOnly.summary?.apiWrites !== 0) throw Error('只读保护证据存在失败或写入。');
if (status.businessWrites !== 0 || status.pageAcceptance !== false || status.battleValidation !== false) throw Error('当前候选状态不是纯候选阶段。');

const order = ['vladimir', 'swain', 'rumble', 'aurelionsol'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => hero + '_' + slot));
if (JSON.stringify(Object.keys(candidate.skills)) !== JSON.stringify(order)) throw Error('候选技能顺序不是固定20槽。');

const kinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
const counts = Object.fromEntries(kinds.map(kind => [kind, order.reduce((sum, key) => sum + candidate.skills[key].write[kind].length, 0)]));
const files = [
  'README.md',
  '范围与来源说明.md',
  '体验报告.md',
  '候选.mjs',
  '英雄组成.mjs',
  '生成候选.mjs',
  '生成写前计划.mjs',
  '独立源值与算例.mjs',
  '生成冻结锁.mjs',
  '完整候选.json',
  '候选版本.json',
  '写前计划.json',
  '独立源值与算例.json',
  '只读保护与公共参数.json',
  '当前候选状态.json',
  '来源冻结/来源与哈希汇总.json'
];
const lockedFiles = Object.fromEntries(files.map(name => [name, sha(name)]));
const sourceSummary = json('来源冻结/来源与哈希汇总.json');
const lock = {
  at: new Date().toISOString(),
  status: '候选已冻结，等待主负责人审查；不是实录',
  source: 'client16.17/official16.17.1',
  sourceBuild: '16.17.8104348+branch.releases-16-17.content.release',
  candidateFileSha256: sha('完整候选.json'),
  candidatePlanSha256: version.planSha256,
  candidateVersionFileSha256: sha('候选版本.json'),
  writePlanFileSha256: sha('写前计划.json'),
  independentMathFileSha256: sha('独立源值与算例.json'),
  readOnlyFileSha256: sha('只读保护与公共参数.json'),
  counts,
  totalNewRequests: writePlan.requestCount,
  reusedPublicParameters: writePlan.reusedPublicParameters.length,
  api: {
    readOnlyRequests: readOnly.summary.requests,
    successfulReadOnlyRequests: readOnly.summary.statusCounts?.['200'] ?? 0,
    failures: readOnly.summary.failures,
    businessWrites: 0
  },
  independentMath: math.summary.independentChecks,
  protectedReadOnly: writePlan.protectedReadOnly,
  sourceHashes: sourceSummary.heroes.map(hero => ({
    id: hero.id,
    clientSha256: hero.client.sha256,
    officialSha256: hero.official.sha256
  })),
  lockedFiles,
  policy: '冻结后禁止覆盖候选、计划和证据；如需修订，另存修订版并由主负责人协调。'
};

fs.writeFileSync(new URL('冻结候选锁.json', here), JSON.stringify(lock, null, 2) + '\n');
console.log(JSON.stringify({
  status: lock.status,
  candidateFileSha256: lock.candidateFileSha256,
  candidatePlanSha256: lock.candidatePlanSha256,
  totalNewRequests: lock.totalNewRequests,
  counts: lock.counts,
  businessWrites: lock.api.businessWrites
}, null, 2));
