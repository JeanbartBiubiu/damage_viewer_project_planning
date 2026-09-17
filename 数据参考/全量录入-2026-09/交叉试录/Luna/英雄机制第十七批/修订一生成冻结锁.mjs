import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const read = name => fs.readFileSync(new URL(name, here));
const json = name => JSON.parse(read(name));
const sha = name => createHash('sha256').update(read(name)).digest('hex');
const oldLockName = '冻结候选锁.json';
const oldLockSha256 = '14d765b96cbe8a49a947d7b5d8e359dc3c6c6b43a799c9f2a26e0d6c35866d2d';
const oldCandidateSha256 = '7a09c5e2597c819aa38c7ac0901e047c2709cfcdb1be6310ebafe9ff926cc14a';
const readOnlySha256 = 'ba50c2f11595df9c64d95345b4af156f9e468656b3bcdb8634558048bad8b62c';
if (sha(oldLockName) !== oldLockSha256) throw Error('旧冻结锁散列变化。');
const oldLock = json(oldLockName);
for (const [name, expected] of Object.entries(oldLock.lockedFiles ?? {})) {
  if (!fs.existsSync(new URL(name, here))) throw Error(`旧冻结文件缺失：${name}`);
  if (sha(name) !== expected) throw Error(`旧冻结文件已被修改：${name}`);
}
if (sha('完整候选.json') !== oldCandidateSha256) throw Error('旧候选散列变化。');
if (fs.existsSync(new URL('修订一冻结候选锁.json', here))) throw Error('修订一冻结锁已存在，不覆盖。');

const candidate = json('修订一候选.json');
const plan = json('修订一写前计划.json');
const math = json('修订一独立源值与算例.json');
const status = json('修订一当前候选状态.json');
const diff = json('修订一差异.json');
const readOnly = json('只读保护与公共参数.json');
const sourceSummary = json('来源冻结/来源与哈希汇总.json');
if (candidate.meta?.apiWrites !== 0 || plan.policy?.businessWrites !== 0 || plan.policy?.apiCalls !== 0) throw Error('修订一包含业务写入标记。');
if (math.summary?.independentChecks?.failed !== 0 || math.summary?.independentChecks?.passed !== 500) throw Error('修订一独立核算未达到500/500。');
if (readOnly.summary?.requests !== 53 || readOnly.summary?.failures !== 0 || readOnly.summary?.apiWrites !== 0 || sha('只读保护与公共参数.json') !== readOnlySha256) throw Error('只读保护证据不符合冻结条件。');
if (status.pageAcceptance !== false || status.battleValidation !== false || status.businessWrites !== 0 || status.apiCalls !== 0) throw Error('修订一状态不是纯候选阶段。');
if (diff.base.candidateSha256 !== oldCandidateSha256 || diff.revised.candidateSha256 !== sha('修订一候选.json')) throw Error('修订差异基线或修订散列不一致。');
if (plan.requestCount !== 263 || plan.reusedPublicParameters.length !== 22) throw Error('修订请求数或复用数不一致。');

const order = ['vladimir', 'swain', 'rumble', 'aurelionsol'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
if (JSON.stringify(Object.keys(candidate.skills)) !== JSON.stringify(order)) throw Error('候选技能顺序不是固定20槽。');
const counts = Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(kind => [kind, order.reduce((sum, key) => sum + candidate.skills[key].write[kind].length, 0)]));
const newCounts = { ...counts, parameters: counts.parameters - 22 };
if (JSON.stringify(counts) !== JSON.stringify({ parameters: 224, formulas: 47, effects: 14, processes: 0, internalStates: 0, triggerRules: 0 })) throw Error('修订总计数不一致。');
if (JSON.stringify(newCounts) !== JSON.stringify({ parameters: 202, formulas: 47, effects: 14, processes: 0, internalStates: 0, triggerRules: 0 })) throw Error('修订新增计数不一致。');
if (plan.requests.some(item => item.method !== 'POST')) throw Error('计划包含非POST请求。');
if (plan.requests.some(item => ['processes', 'internalStates', 'triggerRules'].includes(item.kind))) throw Error('计划包含禁止的过程/状态/规则请求。');
const reused = new Set(plan.reusedPublicParameters.map(item => item.skillKey + '/' + item.parameterKey));
if (plan.requests.some(item => item.kind === 'parameters' && reused.has(item.skillKey + '/' + item.stableKey))) throw Error('计划包含公共参数复用POST。');
for (const key of order) {
  const skill = candidate.skills[key];
  if (skill.write.processes.length || skill.write.internalStates.length || skill.write.triggerRules.length) throw Error(`候选包含禁止组成 ${key}`);
  for (const effect of skill.write.effects) {
    const duration = effect.lifecycle?.durationValue;
    if (duration && (duration.nodeType || duration.kind !== 'PARAMETER')) throw Error(`效果生命周期结构错误 ${key}/${effect.effectKey}`);
  }
}

const revisionFiles = [
  '修订一候选.json',
  '修订一候选生成报告.json',
  '修订一写前计划.json',
  '修订一独立源值与算例.json',
  '修订一差异.json',
  '修订一差异.md',
  '修订一当前候选状态.json',
  '修订一生成候选.mjs',
  '修订一写前计划.mjs',
  '修订一独立源值与算例.mjs',
  '修订一差异.mjs',
  '修订一生成状态.mjs',
  '修订一生成冻结锁.mjs',
  '只读保护与公共参数.json',
  '补充文本证据.json',
  '根绑定与数值证据.json',
  '来源冻结/来源与哈希汇总.json'
];
const lockedFiles = Object.fromEntries(revisionFiles.map(name => [name, sha(name)]));
const lock = {
  at: new Date().toISOString(),
  status: '修订一候选已冻结，等待主负责人审查；不是实录',
  revision: '修订一',
  source: 'client16.17/official16.17.1',
  sourceBuild: '16.17.8104348+branch.releases-16-17.content.release',
  baseCandidateSha256: oldCandidateSha256,
  baseLockSha256: oldLockSha256,
  candidateFileSha256: sha('修订一候选.json'),
  candidatePlanSha256: plan.candidatePlanSha256,
  writePlanFileSha256: sha('修订一写前计划.json'),
  independentMathFileSha256: sha('修订一独立源值与算例.json'),
  diffFileSha256: sha('修订一差异.json'),
  statusFileSha256: sha('修订一当前候选状态.json'),
  counts,
  newCounts,
  totalNewRequests: plan.requestCount,
  reusedPublicParameters: plan.reusedPublicParameters.length,
  api: {
    readOnlyRequests: readOnly.summary.requests,
    successfulReadOnlyRequests: readOnly.summary.statusCounts?.['200'] ?? 0,
    failures: readOnly.summary.failures,
    businessWrites: 0,
    apiCalls: 0
  },
  independentMath: math.summary.independentChecks,
  protectedReadOnly: plan.protectedReadOnly,
  sourceHashes: sourceSummary.heroes.map(hero => ({ id: hero.id, clientSha256: hero.client.sha256, officialSha256: hero.official.sha256 })),
  baseFrozenFiles: oldLock.lockedFiles,
  lockedFiles,
  policy: '修订一冻结后禁止覆盖修订候选、计划和证据；旧冻结原件散列必须持续匹配；如需再次修订另存新版本并由主负责人协调。'
};
fs.writeFileSync(new URL('修订一冻结候选锁.json', here), JSON.stringify(lock, null, 2) + '\n');
console.log(JSON.stringify({
  status: lock.status,
  baseCandidateSha256: lock.baseCandidateSha256,
  candidateFileSha256: lock.candidateFileSha256,
  candidatePlanSha256: lock.candidatePlanSha256,
  writePlanFileSha256: lock.writePlanFileSha256,
  independentMathFileSha256: lock.independentMathFileSha256,
  diffFileSha256: lock.diffFileSha256,
  counts: lock.counts,
  newCounts: lock.newCounts,
  totalNewRequests: lock.totalNewRequests,
  businessWrites: lock.api.businessWrites,
  oldLockSha256: lock.baseLockSha256
}, null, 2));
