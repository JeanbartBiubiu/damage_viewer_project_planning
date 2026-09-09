import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const read = name => fs.readFileSync(new URL(name, here));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const candidateBytes = read('修订一候选.json');
const candidate = JSON.parse(candidateBytes);
const readOnlyBytes = read('只读保护与公共参数.json');
const readOnly = JSON.parse(readOnlyBytes);
const expectedReadOnlySha256 = 'ba50c2f11595df9c64d95345b4af156f9e468656b3bcdb8634558048bad8b62c';
if (sha(readOnlyBytes) !== expectedReadOnlySha256) throw Error('只读保护证据散列变化，禁止生成修订一写前计划。');
if (readOnly.summary?.requests !== 53 || readOnly.summary?.failures !== 0 || readOnly.summary?.apiWrites !== 0) {
  throw Error('只读保护证据不是53个请求、0失败、0写入，禁止生成修订一写前计划。');
}
if (candidate.meta?.apiWrites !== 0 || candidate.meta?.revision?.baseCandidateSha256 !== '7a09c5e2597c819aa38c7ac0901e047c2709cfcdb1be6310ebafe9ff926cc14a') {
  throw Error('修订一候选缺少纯候选或原始冻结基线标记。');
}
if (fs.existsSync(new URL('修订一写前计划.json', here))) throw Error('修订一写前计划已存在，不覆盖。');

const routes = {
  parameters: 'parameters',
  formulas: 'formulas',
  effects: 'effects',
  processes: 'processes',
  internalStates: 'internal-states',
  triggerRules: 'trigger-rules'
};
const requests = [];
const reused = [];
const order = Object.keys(candidate.skills);
for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  const reusedSet = new Set(skill.reusedParameters ?? []);
  for (const parameterKey of skill.reusedParameters ?? []) reused.push({ skillKey, parameterKey });
  for (const [kind, rows] of Object.entries(skill.write)) {
    const routePart = routes[kind];
    if (!routePart) throw Error('未知组成类别 ' + kind);
    for (const body of rows) {
      const stableKey = body.parameterKey ?? body.formulaKey ?? body.effectKey ?? body.processKey ?? body.stateKey ?? body.ruleKey;
      if (!stableKey) throw Error('写前组成缺稳定键 ' + skillKey + '/' + kind);
      if (kind === 'parameters' && reusedSet.has(stableKey)) continue;
      requests.push({ method: 'POST', route: '/skills/' + skillKey + '/' + routePart, skillKey, kind, stableKey, body });
    }
  }
}

if (reused.length !== 22) throw Error(`复用公共参数应为22个，实际${reused.length}个。`);
if (requests.some(item => item.method !== 'POST')) throw Error('写前计划含非POST请求。');
if (requests.some(item => item.kind === 'parameters' && reused.some(row => row.skillKey === item.skillKey && row.parameterKey === item.stableKey))) throw Error('写前计划错误地包含公共参数复用POST。');
if (requests.some(item => ['processes', 'internalStates', 'triggerRules'].includes(item.kind))) throw Error('修订一写前计划不应有过程、内部状态或触发规则。');

const counts = Object.fromEntries(Object.keys(routes).map(kind => [kind, requests.filter(item => item.kind === kind).length]));
const totalCounts = Object.fromEntries(Object.keys(routes).map(kind => [kind, order.reduce((sum, key) => sum + candidate.skills[key].write[kind].length, 0)]));
const candidatePlanSha256 = createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
const report = {
  at: new Date().toISOString(),
  status: '修订一仅准备POST意图，未获本批业务写入授权',
  revision: {
    name: '修订一',
    baseCandidateSha256: candidate.meta.revision.baseCandidateSha256,
    candidateSha256: sha(candidateBytes)
  },
  policy: {
    businessWrites: 0,
    apiCalls: 0,
    method: '只生成冻结计划，不执行请求',
    endpoint: 'http://127.0.0.1:8080/api/admin/games/lol',
    bearer: '由开发环境提供；认证值不写入文件'
  },
  scope: candidate.meta.scope,
  source: 'client16.17/official16.17.1',
  candidateSha256: sha(candidateBytes),
  candidatePlanSha256,
  readOnlySha256: sha(readOnlyBytes),
  selectionSourceSha256: readOnly.selectionSourceSha256,
  currentReadOnly: readOnly.summary,
  protectedReadOnly: {
    publicParameterDetails: 22,
    characters: 4,
    characterSkillRelations: 4,
    representativeImages: 20,
    catalogs: 3,
    apiWrites: 0
  },
  reusedPublicParameters: reused,
  counts,
  totalCounts,
  requestCount: requests.length,
  requests
};
if (report.requestCount !== 263) throw Error(`修订一新增请求应为263个，实际${report.requestCount}个。`);
fs.writeFileSync(new URL('修订一写前计划.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  status: report.status,
  requestCount: report.requestCount,
  counts,
  totalCounts,
  reusedPublicParameters: reused.length,
  apiCalls: 0,
  businessWrites: 0,
  candidateSha256: report.candidateSha256,
  candidatePlanSha256,
  readOnlySha256: report.readOnlySha256
}, null, 2));
